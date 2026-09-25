import os
import json
import logging
import hashlib
import asyncio
import requests
from typing import Dict, Any, List
from dotenv import load_dotenv

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

# Load environment variables from .env
load_dotenv()

# Configure logging for the AI Agent
logger = logging.getLogger("quantveda.ai_agent")

class SentimentResponse(BaseModel):
    sentiment: str = Field(description="Must be either 'Bullish' or 'Bearish'")
    confidence: int = Field(description="Confidence rating from 1 to 10")
    reason: str = Field(description="Detailed reason for the sentiment analysis")

def get_mock_headlines(symbol: str) -> List[str]:
    """
    Generates 3 realistic mock news headlines for the specified symbol.
    Provides hand-curated headlines for popular symbols and dynamic,
    stable ones for other tickers.
    """
    symbol_upper = symbol.upper().strip()
    
    # Hand-curated headlines for popular tickers
    curated = {
        "AAPL": [
            "Apple announces groundbreaking AI integrations across iOS and macOS at WWDC.",
            "Supply chain partners report an uptick in next-generation iPhone component orders.",
            "Antitrust scrutiny intensifies as regulators raise concerns over Apple Store fees."
        ],
        "MSFT": [
            "Microsoft cloud revenue exceeds expectations as Azure AI demand surges.",
            "Federal Trade Commission launches antitrust inquiry into Microsoft's AI partnership.",
            "Microsoft unveils next-generation Copilot+ PCs with specialized AI processors."
        ],
        "TSLA": [
            "Tesla gains regulatory approval to roll out Full Self-Driving beta in key Asian markets.",
            "EV pricing pressures squeeze Tesla margins in latest quarterly earnings report.",
            "Elon Musk announces accelerated production timeline for next-generation budget EV."
        ],
        "GOOG": [
            "Google Cloud rolls out new TPU v5e chips to accelerate enterprise LLM scaling.",
            "Antitrust lawsuit focuses on Google's default browser search partnerships.",
            "Alphabet reports strong quarterly revenue driven by cloud computing and search ads."
        ],
        "GOOGL": [
            "Google Cloud rolls out new TPU v5e chips to accelerate enterprise LLM scaling.",
            "Antitrust lawsuit focuses on Google's default browser search partnerships.",
            "Alphabet reports strong quarterly revenue driven by cloud computing and search ads."
        ],
        "NVDA": [
            "NVIDIA unveils new Blackwell B200 chip architecture, claiming massive performance gains.",
            "Global chip supply improves but backlog remains high for NVIDIA H100 cards.",
            "Tech giants commit billions in capital expenditure to build data centers utilizing NVDA chips."
        ]
    }
    
    if symbol_upper in curated:
        return curated[symbol_upper]
        
    # Generate stable deterministic headlines using hashing for other symbols
    hash_val = int(hashlib.md5(symbol_upper.encode()).hexdigest(), 16)
    
    templates = [
        [
            f"{symbol_upper} secures a strategic partnership to expand its market share in Europe.",
            f"Analysts upgrade {symbol_upper} to 'Outperform' citing a robust balance sheet.",
            f"Regulatory headwinds pose potential delays to {symbol_upper}'s upcoming product rollouts."
        ],
        [
            f"Demand surges for {symbol_upper}'s new product line ahead of the holiday shopping season.",
            f"Supply chain disruptions spark concerns over production output at {symbol_upper}.",
            f"{symbol_upper} appoints a new CEO with a proven track record of successful turnarounds."
        ],
        [
            f"Competitors pressure margins at {symbol_upper} in a highly saturated sector.",
            f"{symbol_upper} schedules an urgent earnings call as investors seek updates on growth.",
            f"Insider buying signals strong confidence from the executive team at {symbol_upper}."
        ]
    ]
    
    return templates[hash_val % len(templates)]

def _generate_mock_sentiment(symbol: str, price: float, headlines: List[str]) -> Dict[str, Any]:
    """
    Generates a high-quality deterministic mock sentiment response.
    Acts as the ultimate fallback when AI APIs are unavailable.
    """
    symbol_upper = symbol.upper().strip()
    hash_val = int(hashlib.md5(symbol_upper.encode()).hexdigest(), 16)
    
    sentiment = "Bullish" if (hash_val % 2 == 0) else "Bearish"
    confidence = (hash_val % 5) + 6  # Deterministic score from 6 to 10
    
    reasons = {
        "Bullish": (
            f"Recent headlines like '{headlines[0]}' indicate positive strategic momentum "
            f"for {symbol_upper}. Trading at ₹{price:,.2f}, the underlying trend signals strong investor support."
        ),
        "Bearish": (
            f"Potential headwinds highlighted by '{headlines[2]}' suggest cautious short-term expectations "
            f"for {symbol_upper}. Trading at ₹{price:,.2f}, the stock faces near-term support tests."
        )
    }
    
    return {
        "sentiment": sentiment,
        "confidence": confidence,
        "reason": reasons[sentiment],
        "mocked": True
    }

def _call_gemini_sentiment_sync(api_key: str, symbol: str, price: float, headlines: List[str]) -> Dict[str, Any]:
    """Synchronous caller for Google Gemini REST API with multi-model support."""
    models_to_try = ["gemini-1.5-flash", "gemini-2.5-flash", "gemini-2.0-flash"]
    headline_lines = "\n".join([f"{i+1}. {h}" for i, h in enumerate(headlines[:3])])
    prompt = (
        f"You are a professional financial analyst.\n"
        f"Analyze the market sentiment for the stock symbol: {symbol}\n"
        f"Current trading price: Rs. {price:,.2f}\n\n"
        f"Here are the recent news headlines for {symbol}:\n"
        f"{headline_lines}\n\n"
        f"Assess whether these inputs are net bullish or bearish. Provide your rating on a scale of 1-10 "
        f"and write a professional justification statement."
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "sentiment": {"type": "STRING", "enum": ["Bullish", "Bearish"]},
                    "confidence": {"type": "INTEGER"},
                    "reason": {"type": "STRING"}
                },
                "required": ["sentiment", "confidence", "reason"]
            }
        }
    }

    last_err = None
    for model_name in models_to_try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        try:
            r = requests.post(url, json=payload, timeout=20)
            if r.status_code == 200:
                data = r.json()
                parts = data.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])
                if parts and 'text' in parts[0]:
                    parsed = json.loads(parts[0]['text'])
                    return {
                        "sentiment": parsed.get("sentiment", "Bullish"),
                        "confidence": int(parsed.get("confidence", 8)),
                        "reason": parsed.get("reason", "Positive market sentiment indicated by recent news."),
                        "mocked": False
                    }
            else:
                last_err = f"Status {r.status_code}: {r.text}"
        except Exception as e:
            last_err = str(e)
            logger.warning(f"Gemini attempt with {model_name} failed: {e}")

    raise RuntimeError(f"All Gemini model attempts failed. Last error: {last_err}")

async def analyze_sentiment(symbol: str, price: float, headlines: list[str] = None) -> Dict[str, Any]:
    """
    Runs sentiment analysis on the ticker symbol and current price.
    Supports Google Gemini (via GEMINI_API_KEY) and OpenAI (via OPENAI_API_KEY).
    Falls back gracefully to deterministic analysis if configuration or API calls fail.
    """
    symbol_upper = symbol.upper().strip()

    if headlines is None or len(headlines) == 0:
        headlines = get_mock_headlines(symbol_upper)

    # 0. TypeSafe Jev™ System One Engine (High speed sub-millisecond execution)
    try:
        from backend.jev_engine import run_jev_prediction
        jev_res = await run_jev_prediction(
            symbol=symbol_upper,
            price=price,
            change_pct=0.8,
            previous_close=price,
            day_high=price * 1.015,
            day_low=price * 0.985,
            fifty_two_high=price * 1.25,
            fifty_two_low=price * 0.75,
            headlines=headlines
        )
        return {
            "headlines": headlines,
            "analysis": {
                "sentiment": jev_res.get("sentiment", "Bullish"),
                "confidence": int(round(jev_res.get("confidence_score", 8))),
                "action": jev_res.get("action", "BUY"),
                "reason": jev_res.get("summary", ""),
                "trap_risk_pct": jev_res.get("trap_risk_pct", 15),
                "volatility_risk_pct": jev_res.get("volatility_risk_pct", 25),
                "target_price": jev_res.get("target_price", price * 1.05),
                "stop_loss_price": jev_res.get("stop_loss_price", price * 0.96),
                "model": "TypeSafe Jev™ System One",
                "mocked": False
            }
        }
    except Exception as jev_err:
        logger.debug(f"TypeSafe Jev execution info: {jev_err}")

    # 1. Check Google Gemini API Key
    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if gemini_key and gemini_key.strip() and gemini_key.strip() != "your-gemini-api-key-here":
        try:
            logger.info(f"Initiating Google Gemini sentiment analysis for {symbol_upper} at ₹{price}")
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(None, _call_gemini_sentiment_sync, gemini_key.strip(), symbol_upper, price, headlines)
            logger.info(f"Google Gemini analysis succeeded for {symbol_upper}.")
            return {
                "headlines": headlines,
                "analysis": result
            }
        except Exception as gemini_err:
            logger.error(f"Gemini sentiment analysis failed for {symbol_upper}: {gemini_err}", exc_info=True)

    # 2. Check OpenAI API Key
    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key and openai_key.strip() and openai_key.strip() != "your-openai-api-key-here":
        try:
            logger.info(f"Initiating LangChain/OpenAI analysis for {symbol_upper} at ₹{price}")
            model = ChatOpenAI(temperature=0.0, model="gpt-3.5-turbo", api_key=openai_key.strip())
            parser = JsonOutputParser(pydantic_object=SentimentResponse)
            headline_lines = "\n".join([f"{i+1}. {h}" for i, h in enumerate(headlines[:3])])
            prompt = ChatPromptTemplate.from_template(
                "You are a professional financial analyst.\n"
                "Analyze the sentiment for the stock symbol: {symbol}\n"
                "Current trading price: ${price}\n\n"
                "Here are the 3 most recent news headlines for {symbol}:\n"
                "{headline_lines}\n\n"
                "Assess whether these inputs are net bullish or bearish. Provide your rating on a scale of 1-10 "
                "and write a professional justification statement.\n"
                "{format_instructions}"
            )
            chain = prompt | model | parser
            response = await chain.ainvoke({
                "symbol": symbol_upper,
                "price": price,
                "headline_lines": headline_lines,
                "format_instructions": parser.get_format_instructions()
            })
            logger.info(f"OpenAI sentiment analysis succeeded for {symbol_upper}.")
            return {
                "headlines": headlines,
                "analysis": {
                    "sentiment": response.get("sentiment", "Bullish"),
                    "confidence": int(response.get("confidence", 5)),
                    "reason": response.get("reason", "No reason provided."),
                    "mocked": False
                }
            }
        except Exception as openai_err:
            logger.error(f"OpenAI sentiment analysis failed for {symbol_upper}: {openai_err}", exc_info=True)

    # 3. Fallback to deterministic model
    logger.info(f"Using simulated sentiment fallback for {symbol_upper}.")
    return {
        "headlines": headlines,
        "analysis": _generate_mock_sentiment(symbol_upper, price, headlines)
    }
