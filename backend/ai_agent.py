import os
import json
import logging
import hashlib
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
    Acts as the ultimate fallback when OpenAI is unavailable.
    """
    symbol_upper = symbol.upper().strip()
    hash_val = int(hashlib.md5(symbol_upper.encode()).hexdigest(), 16)
    
    sentiment = "Bullish" if (hash_val % 2 == 0) else "Bearish"
    confidence = (hash_val % 5) + 6  # Deterministic score from 6 to 10
    
    reasons = {
        "Bullish": (
            f"Recent headlines like '{headlines[0]}' indicate positive strategic momentum "
            f"for {symbol_upper}. Trading at ${price}, the underlying trend signals strong investor support."
        ),
        "Bearish": (
            f"Potential headwinds highlighted by '{headlines[2]}' suggest cautious short-term expectations "
            f"for {symbol_upper}. Trading at ${price}, the stock faces near-term support tests."
        )
    }
    
    return {
        "sentiment": sentiment,
        "confidence": confidence,
        "reason": reasons[sentiment],
        "mocked": True
    }

async def analyze_sentiment(symbol: str, price: float, headlines: list[str] = None) -> Dict[str, Any]:
    """
    Runs sentiment analysis on the ticker symbol and current price.
    Uses LangChain and OpenAI to extract structured sentiment from real news headlines.
    Falls back gracefully to mock analysis if configuration or API calls fail.
    """
    symbol_upper = symbol.upper().strip()

    if headlines is None or len(headlines) == 0:
        headlines = get_mock_headlines(symbol_upper)
        using_mock_headlines = True
    else:
        using_mock_headlines = False

    # Check if OpenAI API key is configured properly
    api_key = os.getenv("OPENAI_API_KEY")
    is_key_placeholder = api_key is None or api_key.strip() in ["", "your-openai-api-key-here"]

    if is_key_placeholder:
        logger.warning(f"OpenAI API key not configured or contains placeholder. Using mock analysis fallback for {symbol_upper}.")
        return {
            "headlines": headlines,
            "analysis": _generate_mock_sentiment(symbol_upper, price, headlines)
        }

    try:
        logger.info(f"Initiating LangChain LLM analysis for {symbol_upper} at ${price}")

        # Define LLM and output parser
        model = ChatOpenAI(temperature=0.0, model="gpt-3.5-turbo")
        parser = JsonOutputParser(pydantic_object=SentimentResponse)

        # Construct Prompt Template
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

        # Formulate chain
        chain = prompt | model | parser

        # Invoke asynchronously
        response = await chain.ainvoke({
            "symbol": symbol_upper,
            "price": price,
            "headline_lines": headline_lines,
            "format_instructions": parser.get_format_instructions()
        })

        logger.info(f"LLM sentiment analysis succeeded for {symbol_upper}.")
        return {
            "headlines": headlines,
            "analysis": {
                "sentiment": response.get("sentiment", "Bullish"),
                "confidence": int(response.get("confidence", 5)),
                "reason": response.get("reason", "No reason provided."),
                "mocked": False
            }
        }

    except Exception as exc:
        logger.error(f"Error during OpenAI/LangChain sentiment analysis for {symbol_upper}: {exc}", exc_info=True)
        # Graceful fallback instead of throwing error/crashing
        logger.info(f"Falling back to simulated sentiment for {symbol_upper} due to API error.")
        return {
            "headlines": headlines,
            "analysis": _generate_mock_sentiment(symbol_upper, price, headlines)
        }
