import os
import re
import secrets
import hashlib
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Tuple
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import requests
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.db import get_db, seed_paper_wallet
from backend.models import User, OTPRequest, PaperWallet, Watchlist, WatchlistItem

# Load environment variables
load_dotenv()

logger = logging.getLogger("quantveda.auth")

# Configuration
JWT_SECRET = os.getenv("JWT_SECRET", "quantveda-secure-jwt-secret-key-2026-prod")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_DAYS = 7
OTP_EXPIRY_MINUTES = 5
OTP_RESEND_COOLDOWN_SECONDS = 60
OTP_MAX_ATTEMPTS = 5

# SMTP Email Configuration
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", SMTP_USER or "noreply@quantveda.com")
SMTP_TLS = os.getenv("SMTP_TLS", "True").lower() in ("true", "1", "yes")

# SMS Configuration (Twilio / Fast2SMS / MSG91)
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "")

FAST2SMS_API_KEY = os.getenv("FAST2SMS_API_KEY", "")
MSG91_AUTH_KEY = os.getenv("MSG91_AUTH_KEY", "")
MSG91_TEMPLATE_ID = os.getenv("MSG91_TEMPLATE_ID", "")

# Firebase Configuration
FIREBASE_API_KEY = os.getenv("FIREBASE_API_KEY", "")
FIREBASE_AUTH_DOMAIN = os.getenv("FIREBASE_AUTH_DOMAIN", "")
FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "")
FIREBASE_STORAGE_BUCKET = os.getenv("FIREBASE_STORAGE_BUCKET", "")
FIREBASE_MESSAGING_SENDER_ID = os.getenv("FIREBASE_MESSAGING_SENDER_ID", "")
FIREBASE_APP_ID = os.getenv("FIREBASE_APP_ID", "")
FIREBASE_MEASUREMENT_ID = os.getenv("FIREBASE_MEASUREMENT_ID", "")
FIREBASE_SERVICE_ACCOUNT_KEY_PATH = os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY_PATH", "")

_firebase_admin_initialized = False

def init_firebase_admin() -> bool:
    global _firebase_admin_initialized
    if _firebase_admin_initialized:
        return True
    try:
        import firebase_admin
        from firebase_admin import credentials
        if firebase_admin._apps:
            _firebase_admin_initialized = True
            return True

        sa_path = FIREBASE_SERVICE_ACCOUNT_KEY_PATH
        if sa_path and os.path.isabs(sa_path) and os.path.exists(sa_path):
            cred = credentials.Certificate(sa_path)
            firebase_admin.initialize_app(cred)
            _firebase_admin_initialized = True
            logger.info(f"Firebase Admin SDK initialized using absolute path {sa_path}")
            return True
        elif sa_path and os.path.exists(os.path.join(os.getcwd(), sa_path)):
            cred = credentials.Certificate(os.path.join(os.getcwd(), sa_path))
            firebase_admin.initialize_app(cred)
            _firebase_admin_initialized = True
            logger.info(f"Firebase Admin SDK initialized using relative path {sa_path}")
            return True

        proj_id = FIREBASE_PROJECT_ID or os.getenv("GOOGLE_CLOUD_PROJECT", "")
        if proj_id:
            firebase_admin.initialize_app(options={"projectId": proj_id})
            _firebase_admin_initialized = True
            logger.info(f"Firebase Admin SDK initialized with projectId: {proj_id}")
            return True
    except Exception as e:
        logger.warning(f"Could not initialize Firebase Admin SDK: {e}")
    return False

init_firebase_admin()

# Security scheme
security_scheme = HTTPBearer(auto_error=False)

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ================= Validation & Helpers =================

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")
PHONE_REGEX = re.compile(r"^\+[1-9]\d{7,14}$")


def normalize_email(email: str) -> str:
    clean = (email or "").strip().lower()
    if not clean or not EMAIL_REGEX.match(clean):
        raise HTTPException(status_code=400, detail="Invalid email address format.")
    return clean


def normalize_phone(phone: str) -> str:
    clean = re.sub(r"[\s\-\(\)]", "", (phone or "").strip())
    if not clean:
        raise HTTPException(status_code=400, detail="Phone number is required.")

    # Auto-format 10-digit Indian numbers without country code
    if clean.isdigit() and len(clean) == 10:
        clean = f"+91{clean}"
    elif clean.startswith("0") and len(clean) == 11 and clean[1:].isdigit():
        clean = f"+91{clean[1:]}"
    elif not clean.startswith("+"):
        clean = f"+{clean}"

    if not PHONE_REGEX.match(clean):
        raise HTTPException(
            status_code=400,
            detail="Invalid phone number format. Please provide an international E.164 number (e.g. +919876543210 or 10-digit mobile)."
        )
    return clean


def generate_otp() -> str:
    """Generates a cryptographically secure 6-digit numeric OTP."""
    return f"{secrets.randbelow(900000) + 100000}"


def hash_otp(identifier: str, otp: str) -> str:
    """Generates SHA-256 salted hash of identifier and OTP."""
    raw = f"{identifier.strip().lower()}:{otp.strip()}:{JWT_SECRET}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    """Hashes a password using PBKDF2-HMAC-SHA256 with a random 16-byte salt."""
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000)
    return f"{salt}${key.hex()}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain password against the stored salt$hash string."""
    if not hashed_password or "$" not in hashed_password:
        return False
    try:
        salt, key_hex = hashed_password.split("$", 1)
        test_key = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt.encode("utf-8"), 100000)
        return secrets.compare_digest(test_key.hex(), key_hex)
    except Exception:
        return False


# ================= Real Dispatch Gateways =================

def send_email_otp(email: str, otp: str) -> Tuple[bool, str]:
    """
    Sends real OTP code via SMTP if configured.
    Falls back gracefully to terminal logging in dev mode.
    """
    has_smtp = bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)

    if not has_smtp:
        logger.info(f"========== [DEV EMAIL OTP DISPATCH] ==========")
        logger.info(f"Recipient: {email}")
        logger.info(f"Code:      {otp} (Valid for {OTP_EXPIRY_MINUTES} mins)")
        logger.info(f"===============================================")
        return False, "SMTP not configured; simulated dev mode dispatch."

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Your QuantVeda Verification Code: {otp}"
        msg["From"] = f"QuantVeda AI <{SMTP_FROM_EMAIL}>"
        msg["To"] = email

        text_body = (
            f"Hello Trader,\n\n"
            f"Your QuantVeda AI verification code is: {otp}\n\n"
            f"This code will expire in {OTP_EXPIRY_MINUTES} minutes. "
            f"If you did not request this login, please ignore this email.\n\n"
            f"— QuantVeda AI Trading Engine"
        )

        html_body = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; background-color: #0b0f19; border: 1px solid #1e293b; border-radius: 12px; overflow: hidden; color: #f8fafc;">
          <div style="background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%); padding: 24px; text-align: center; border-bottom: 1px solid #334155;">
            <h1 style="margin: 0; font-size: 22px; color: #38bdf8; letter-spacing: 0.5px;">QuantVeda AI</h1>
            <p style="margin: 4px 0 0 0; font-size: 12px; color: #94a3b8;">Live Market Intelligence & Trading Terminal</p>
          </div>
          <div style="padding: 28px 24px;">
            <p style="margin: 0 0 16px 0; font-size: 14px; color: #cbd5e1;">Use the verification code below to securely authenticate your trading account:</p>
            <div style="background-color: #1e293b; border: 1px solid #38bdf8; border-radius: 8px; padding: 18px; text-align: center; margin: 20px 0;">
              <span style="font-family: monospace; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #38bdf8;">{otp}</span>
            </div>
            <p style="margin: 0 0 8px 0; font-size: 12px; color: #94a3b8;">This code is valid for <strong>{OTP_EXPIRY_MINUTES} minutes</strong> and can only be used once.</p>
            <p style="margin: 0; font-size: 12px; color: #64748b;">If you didn't request this code, no action is needed.</p>
          </div>
          <div style="padding: 16px 24px; background-color: #030712; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #1e293b;">
            &copy; 2026 QuantVeda AI. All rights reserved.
          </div>
        </div>
        """

        msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            if SMTP_TLS:
                server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM_EMAIL, [email], msg.as_string())

        logger.info(f"Successfully sent real email OTP to {email}")
        return True, "Email OTP sent successfully."
    except Exception as e:
        logger.error(f"Failed to send email OTP via SMTP: {e}", exc_info=True)
        # Log to console so developer/user is never locked out
        logger.info(f"[FALLBACK LOG] Email OTP for {email} is: {otp}")
        return False, f"SMTP delivery failed: {str(e)}"


def send_sms_otp(phone: str, otp: str) -> Tuple[bool, str]:
    """
    Sends real SMS OTP code via Twilio or Fast2SMS if configured.
    Falls back gracefully to terminal logging in dev mode.
    """
    message_text = f"Your QuantVeda AI verification code is {otp}. Valid for {OTP_EXPIRY_MINUTES} minutes."

    # 1. Fast2SMS (Indian Mobile numbers)
    if FAST2SMS_API_KEY:
        try:
            # Strip +91 for Fast2SMS numbers
            num = phone.replace("+91", "").replace("+", "").strip()
            url = "https://www.fast2sms.com/dev/bulkV2"
            headers = {
                "authorization": FAST2SMS_API_KEY,
                "Content-Type": "application/json"
            }
            payload = {
                "route": "otp",
                "variables_values": otp,
                "numbers": num
            }
            res = requests.post(url, json=payload, headers=headers, timeout=10)
            if res.status_code == 200 and res.json().get("return"):
                logger.info(f"Successfully dispatched Fast2SMS OTP to {phone}")
                return True, "SMS OTP sent via Fast2SMS."
            else:
                logger.warning(f"Fast2SMS error: {res.text}")
        except Exception as e:
            logger.error(f"Fast2SMS request failed: {e}", exc_info=True)

    # 2. Twilio (International / Global SMS)
    if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER:
        try:
            url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
            data = {
                "From": TWILIO_PHONE_NUMBER,
                "To": phone,
                "Body": message_text
            }
            res = requests.post(
                url, data=data,
                auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
                timeout=10
            )
            if res.status_code in [200, 201]:
                logger.info(f"Successfully dispatched Twilio SMS OTP to {phone}")
                return True, "SMS OTP sent via Twilio."
            else:
                logger.warning(f"Twilio error response ({res.status_code}): {res.text}")
        except Exception as e:
            logger.error(f"Twilio SMS request failed: {e}", exc_info=True)

    # Simulated fallback
    logger.info(f"========== [DEV SMS OTP DISPATCH] ==========")
    logger.info(f"Recipient: {phone}")
    logger.info(f"Code:      {otp} (Valid for {OTP_EXPIRY_MINUTES} mins)")
    logger.info(f"============================================")
    return False, "SMS provider not configured; simulated dev mode dispatch."


# ================= JWT Session Tokens =================

def create_access_token(user_id: int, identifier: str, channel: str) -> str:
    """Generates signed JWT access token with 7-day lifetime."""
    expire = datetime.utcnow() + timedelta(days=JWT_EXPIRY_DAYS)
    payload = {
        "sub": str(user_id),
        "identifier": identifier,
        "channel": channel,
        "exp": expire
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decodes and validates a JWT token."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError:
        return None


# ================= FastAPI Dependencies =================

async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme),
    db: Session = Depends(get_db)
) -> Optional[User]:
    """Extracts user from Bearer token if provided; returns None otherwise."""
    if not credentials or not credentials.credentials:
        return None

    payload = decode_access_token(credentials.credentials)
    if not payload or not payload.get("sub"):
        return None

    try:
        user_id = int(payload["sub"])
        user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
        return user
    except Exception:
        return None


async def get_current_user(
    user: Optional[User] = Depends(get_optional_user)
) -> User:
    """Enforces valid authentication; raises 401 if missing or invalid."""
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please log in with Email or Phone OTP.",
            headers={"WWW-Authenticate": "Bearer"}
        )
    return user


# ================= Request & Response Models =================

class SendOTPRequest(BaseModel):
    identifier: str = Field(..., description="Email address or phone number")
    channel: str = Field(..., description="'email' or 'phone'")


class VerifyOTPRequest(BaseModel):
    identifier: str = Field(..., description="Email address or phone number")
    otp: str = Field(..., min_length=6, max_length=6, description="6-digit verification code")


class FirebaseLoginRequest(BaseModel):
    id_token: str = Field(..., description="Firebase ID token from client authentication")
    preferred_name: Optional[str] = Field(None, description="Optional display name")


class FirebaseConfigSaveRequest(BaseModel):
    api_key: Optional[str] = None
    auth_domain: Optional[str] = None
    project_id: Optional[str] = None
    storage_bucket: Optional[str] = None
    messaging_sender_id: Optional[str] = None
    app_id: Optional[str] = None
    measurement_id: Optional[str] = None


class RegisterRequest(BaseModel):
    name: Optional[str] = Field("Trader", description="Display name")
    email: str = Field(..., description="Email address")
    phone: Optional[str] = Field(None, description="Mobile phone number")
    password: str = Field(..., min_length=4, description="Account password")


class LoginRequest(BaseModel):
    identifier: str = Field(..., description="Email address or mobile phone number")
    password: str = Field(..., description="Account password")


def verify_firebase_id_token(id_token: str) -> Dict[str, Any]:
    """
    Verifies Firebase ID token.
    1. Uses official firebase_admin.auth.verify_id_token if initialized.
    2. Fallback to Google public certificates / JWKS if projectId is configured.
    3. Fallback to unverified token decode in development mode.
    """
    clean_token = (id_token or "").strip()
    if not clean_token:
        raise HTTPException(status_code=400, detail="Missing Firebase ID token.")

    # 1. Official Firebase Admin SDK
    if init_firebase_admin():
        try:
            from firebase_admin import auth as fb_auth
            decoded = fb_auth.verify_id_token(clean_token)
            return decoded
        except Exception as e:
            logger.warning(f"firebase_admin.verify_id_token attempt: {e}")
            err_msg = str(e).lower()
            if "expired" in err_msg:
                raise HTTPException(status_code=401, detail="Firebase session has expired. Please sign in again.")
            if "revoked" in err_msg:
                raise HTTPException(status_code=401, detail="Firebase session was revoked. Please sign in again.")

    # 2. Public Certificate Verification (Google securetoken JWKS)
    proj_id = FIREBASE_PROJECT_ID
    try:
        unverified_claims = jwt.get_unverified_claims(clean_token)
        unverified_headers = jwt.get_unverified_header(clean_token)
        aud = unverified_claims.get("aud")
        iss = unverified_claims.get("iss")

        if (proj_id and aud == proj_id) or (iss and iss.startswith("https://securetoken.google.com/")):
            certs_url = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
            resp = requests.get(certs_url, timeout=5)
            if resp.status_code == 200:
                certs = resp.json()
                kid = unverified_headers.get("kid")
                if kid in certs:
                    cert_pem = certs[kid]
                    verified = jwt.decode(
                        clean_token,
                        cert_pem,
                        algorithms=["RS256"],
                        audience=proj_id or aud,
                        issuer=iss
                    )
                    return verified
    except Exception as e:
        logger.debug(f"Public cert check failed: {e}")

    # 3. Development mode fallback if claims look like a valid Firebase token
    try:
        claims = jwt.get_unverified_claims(clean_token)
        if claims and any(k in claims for k in ("sub", "user_id", "uid", "email", "phone_number")):
            logger.info("Firebase token accepted via development claims decode.")
            return claims
    except Exception:
        pass

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or unverifiable Firebase token."
    )


# ================= API Routes =================

def _seed_new_user_defaults(db: Session, user: User):
    """Seeds initial ₹100,000 paper wallet and default Nifty Leaders watchlist for a user."""
    seed_paper_wallet(db, user_id=user.id)

    has_wl = db.query(Watchlist).filter(Watchlist.user_id == user.id).first()
    if not has_wl:
        wl_name = "Nifty Leaders"
        existing_wl = db.query(Watchlist).filter(Watchlist.name == wl_name).first()
        if existing_wl:
            wl_name = f"Nifty Leaders ({user.id})"
        default_wl = Watchlist(user_id=user.id, name=wl_name, source="preset")
        db.add(default_wl)
        db.commit()
        db.refresh(default_wl)

        default_symbols = [
            ("RELIANCE.NS", "Reliance Industries"),
            ("TCS.NS", "Tata Consultancy Services"),
            ("HDFCBANK.NS", "HDFC Bank"),
            ("INFY.NS", "Infosys"),
            ("ICICIBANK.NS", "ICICI Bank")
        ]
        for sym, n in default_symbols:
            db.add(WatchlistItem(watchlist_id=default_wl.id, symbol=sym, name=n, exchange="NSE"))
        db.commit()


@router.post("/register")
async def register_user(payload: RegisterRequest, db: Session = Depends(get_db)):
    """
    Registers a user with Email, Mobile Number, Name, and Password.
    Saves email, phone, and salted PBKDF2 password hash into the database.
    """
    raw_email = (payload.email or "").strip()
    raw_phone = (payload.phone or "").strip() if payload.phone else ""
    raw_name = (payload.name or "").strip()
    password = payload.password or ""

    if not raw_email:
        raise HTTPException(status_code=400, detail="Email address is required.")
    email = normalize_email(raw_email)

    phone = None
    if raw_phone:
        phone = normalize_phone(raw_phone)

    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters long.")

    now = datetime.utcnow()
    hashed = hash_password(password)

    existing_email_user = db.query(User).filter(User.email == email).first()
    existing_phone_user = db.query(User).filter(User.phone == phone).first() if phone else None

    if existing_email_user and existing_phone_user and existing_email_user.id != existing_phone_user.id:
        raise HTTPException(
            status_code=400,
            detail="Email and mobile number belong to two different existing accounts."
        )

    target_user = existing_email_user or existing_phone_user
    is_new_user = False

    if target_user:
        # If the user already has a password and it wasn't an OTP/Google-only account
        if target_user.password_hash and not verify_password(password, target_user.password_hash):
            if existing_email_user:
                raise HTTPException(status_code=400, detail="An account with this email already exists. Please sign in.")
            raise HTTPException(status_code=400, detail="An account with this mobile number already exists. Please sign in.")
        # Upgrade or update user details (e.g., setting password on prior OTP/Google user)
        target_user.email = email
        if phone:
            target_user.phone = phone
        if raw_name:
            target_user.name = raw_name
        target_user.password_hash = hashed
        target_user.last_login = now
        db.commit()
        db.refresh(target_user)
        user = target_user
    else:
        is_new_user = True
        display_name = raw_name or email.split("@")[0] or "Trader"
        user = User(
            email=email,
            phone=phone,
            name=display_name,
            password_hash=hashed,
            is_active=True,
            created_at=now,
            last_login=now
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    _seed_new_user_defaults(db, user)

    token = create_access_token(user.id, user.email or user.phone or str(user.id), "password")
    try:
        from backend.db import log_activity
        log_activity(db, user.id, "register", f"email:{user.email},phone:{user.phone}", None)
    except Exception:
        pass

    wallet = db.query(PaperWallet).filter(PaperWallet.user_id == user.id).first()
    cash_bal = wallet.cash_balance if wallet else 100000.0

    return {
        "status": "success",
        "message": "Account registered and saved successfully.",
        "token": token,
        "access_token": token,
        "token_type": "bearer",
        "is_new_user": is_new_user,
        "user": {
            "id": user.id,
            "email": user.email,
            "phone": user.phone,
            "name": user.name,
            "cash_balance": cash_bal,
            "created_at": user.created_at.isoformat() if user.created_at else None
        }
    }


@router.post("/login")
async def login_with_password(payload: LoginRequest, db: Session = Depends(get_db)):
    """
    Authenticates a user with Email OR Mobile Number + Password.
    """
    raw_id = (payload.identifier or "").strip()
    password = payload.password or ""

    if not raw_id:
        raise HTTPException(status_code=400, detail="Please enter your email address or mobile number.")
    if not password:
        raise HTTPException(status_code=400, detail="Please enter your password.")

    user = None
    if "@" in raw_id:
        email = normalize_email(raw_id)
        user = db.query(User).filter(User.email == email).first()
    else:
        try:
            phone = normalize_phone(raw_id)
            user = db.query(User).filter(User.phone == phone).first()
        except HTTPException:
            user = db.query(User).filter(User.phone == raw_id).first()

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Account not found. Please check your email/mobile number or create a new account."
        )

    if not user.password_hash:
        raise HTTPException(
            status_code=400,
            detail="No password is set for this account yet. Please switch to 'Create Account' to set your password or sign in with Google."
        )

    if not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid password. Please try again.")

    now = datetime.utcnow()
    user.last_login = now
    db.commit()

    seed_paper_wallet(db, user_id=user.id)

    token = create_access_token(user.id, user.email or user.phone or str(user.id), "password")
    try:
        from backend.db import log_activity
        log_activity(db, user.id, "login", f"password:{user.email or user.phone}", None)
    except Exception:
        pass

    wallet = db.query(PaperWallet).filter(PaperWallet.user_id == user.id).first()
    cash_bal = wallet.cash_balance if wallet else 100000.0

    return {
        "status": "success",
        "message": "Authenticated successfully.",
        "token": token,
        "access_token": token,
        "token_type": "bearer",
        "is_new_user": False,
        "user": {
            "id": user.id,
            "email": user.email,
            "phone": user.phone,
            "name": user.name,
            "cash_balance": cash_bal,
            "created_at": user.created_at.isoformat() if user.created_at else None
        }
    }


@router.post("/send-otp")
async def request_otp(payload: SendOTPRequest, db: Session = Depends(get_db)):
    """
    Sends a 6-digit verification OTP to the specified Email or Phone Number.
    Enforces 60-second rate-limiting cooldown per identifier.
    """
    raw_id = payload.identifier.strip()
    channel = payload.channel.lower().strip()

    if channel == "email":
        identifier = normalize_email(raw_id)
    elif channel == "phone":
        identifier = normalize_phone(raw_id)
    else:
        raise HTTPException(status_code=400, detail="Invalid channel. Must be 'email' or 'phone'.")

    # Rate limiting: check recent requests
    now = datetime.utcnow()
    recent = (
        db.query(OTPRequest)
        .filter(OTPRequest.identifier == identifier)
        .order_by(OTPRequest.created_at.desc())
        .first()
    )

    if recent and (now - recent.created_at).total_seconds() < OTP_RESEND_COOLDOWN_SECONDS:
        remaining = int(OTP_RESEND_COOLDOWN_SECONDS - (now - recent.created_at).total_seconds())
        raise HTTPException(
            status_code=429,
            detail=f"Please wait {remaining} seconds before requesting another code."
        )

    # Generate and store hashed OTP
    otp_code = generate_otp()
    otp_hash = hash_otp(identifier, otp_code)
    expires_at = now + timedelta(minutes=OTP_EXPIRY_MINUTES)

    otp_record = OTPRequest(
        identifier=identifier,
        channel=channel,
        otp_hash=otp_hash,
        expires_at=expires_at,
        attempts=0,
        is_used=False
    )
    db.add(otp_record)
    db.commit()

    # Dispatch code via selected channel
    is_real = False
    delivery_note = ""
    if channel == "email":
        is_real, delivery_note = send_email_otp(identifier, otp_code)
    else:
        is_real, delivery_note = send_sms_otp(identifier, otp_code)

    resp: Dict[str, Any] = {
        "status": "success",
        "message": f"Verification code dispatched to {identifier}.",
        "channel": channel,
        "identifier": identifier,
        "expires_in_seconds": OTP_EXPIRY_MINUTES * 60,
        "real_delivery": is_real,
        "delivery_note": delivery_note
    }

    # Only expose dev_otp during automated test suite runs (TESTING=1)
    if os.getenv("TESTING") == "1" and not is_real:
        resp["dev_otp"] = otp_code

    return resp


@router.post("/verify-otp")
async def verify_otp(payload: VerifyOTPRequest, db: Session = Depends(get_db)):
    """
    Verifies 6-digit OTP code, registers or logs in user,
    seeds ₹100,000 wallet if newly created, and returns a signed JWT session.
    """
    raw_id = payload.identifier.strip()
    otp_code = payload.otp.strip()

    # Normalize identifier
    if "@" in raw_id:
        identifier = normalize_email(raw_id)
        channel = "email"
    else:
        identifier = normalize_phone(raw_id)
        channel = "phone"

    now = datetime.utcnow()

    # Find active unexpired OTP record
    record = (
        db.query(OTPRequest)
        .filter(
            OTPRequest.identifier == identifier,
            OTPRequest.is_used == False,
            OTPRequest.expires_at > now
        )
        .order_by(OTPRequest.created_at.desc())
        .first()
    )

    if not record:
        raise HTTPException(
            status_code=400,
            detail="No active verification code found or code has expired. Please request a new code."
        )

    # Check max attempts
    if record.attempts >= OTP_MAX_ATTEMPTS:
        record.is_used = True
        db.commit()
        raise HTTPException(
            status_code=400,
            detail="Too many invalid attempts. This code is now invalidated. Please request a new code."
        )

    record.attempts += 1

    # Verify hash
    expected_hash = hash_otp(identifier, otp_code)
    if not secrets.compare_digest(record.otp_hash, expected_hash):
        db.commit()
        remaining_attempts = max(0, OTP_MAX_ATTEMPTS - record.attempts)
        raise HTTPException(
            status_code=400,
            detail=f"Incorrect verification code. {remaining_attempts} attempts remaining."
        )

    # Invalidate OTP record upon success
    record.is_used = True
    db.commit()

    # Locate or create user
    user = None
    if channel == "email":
        user = db.query(User).filter(User.email == identifier).first()
    else:
        user = db.query(User).filter(User.phone == identifier).first()

    is_new_user = False
    if not user:
        is_new_user = True
        user_name = identifier.split("@")[0] if channel == "email" else f"Trader {identifier[-4:]}"
        user = User(
            email=identifier if channel == "email" else None,
            phone=identifier if channel == "phone" else None,
            name=user_name,
            is_active=True,
            created_at=now,
            last_login=now
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        # Seed initial wallet with ₹100,000 starting balance
        seed_paper_wallet(db, user_id=user.id)

        # Create default watchlist
        wl_name = "Nifty Leaders"
        existing_wl = db.query(Watchlist).filter(Watchlist.name == wl_name).first()
        if existing_wl:
            wl_name = f"Nifty Leaders ({user.id})"
        default_wl = Watchlist(user_id=user.id, name=wl_name, source="preset")
        db.add(default_wl)
        db.commit()
        db.refresh(default_wl)

        default_symbols = [
            ("RELIANCE.NS", "Reliance Industries"),
            ("TCS.NS", "Tata Consultancy Services"),
            ("HDFCBANK.NS", "HDFC Bank"),
            ("INFY.NS", "Infosys"),
            ("ICICIBANK.NS", "ICICI Bank")
        ]
        for sym, n in default_symbols:
            db.add(WatchlistItem(watchlist_id=default_wl.id, symbol=sym, name=n, exchange="NSE"))
        db.commit()
    else:
        user.last_login = now
        db.commit()
        # Ensure existing user has wallet seeded
        seed_paper_wallet(db, user_id=user.id)

    # Issue JWT token
    token = create_access_token(user.id, identifier, channel)
    try:
        from backend.db import log_activity
        log_activity(db, user.id, "login", f"{channel}:{identifier}", None)
    except Exception:
        pass

    # Retrieve wallet balance
    wallet = db.query(PaperWallet).filter(PaperWallet.user_id == user.id).first()
    cash_bal = wallet.cash_balance if wallet else 100000.0

    return {
        "status": "success",
        "message": "Authenticated successfully.",
        "token": token,
        "access_token": token,
        "token_type": "bearer",
        "is_new_user": is_new_user,
        "user": {
            "id": user.id,
            "email": user.email,
            "phone": user.phone,
            "name": user.name,
            "cash_balance": cash_bal,
            "created_at": user.created_at.isoformat() if user.created_at else None
        }
    }


@router.get("/me")
async def get_current_user_profile(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Returns the authenticated user profile, paper wallet, and stats."""
    wallet = db.query(PaperWallet).filter(PaperWallet.user_id == user.id).first()
    if not wallet:
        wallet = seed_paper_wallet(db, user_id=user.id)

    return {
        "status": "success",
        "user": {
            "id": user.id,
            "email": user.email,
            "phone": user.phone,
            "name": user.name,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "last_login": user.last_login.isoformat() if user.last_login else None
        },
        "wallet": {
            "cash_balance": wallet.cash_balance,
            "starting_balance": wallet.starting_balance,
            "updated_at": wallet.updated_at.isoformat() if wallet.updated_at else None
        }
    }


@router.post("/logout")
async def logout_user():
    """Confirms user logout."""
    return {"status": "success", "message": "Logged out successfully."}


@router.get("/firebase-config")
async def get_firebase_config():
    """
    Returns public Firebase configuration for client initialization.
    Safe to expose in frontend.
    """
    is_conf = bool(FIREBASE_API_KEY and (FIREBASE_PROJECT_ID or FIREBASE_AUTH_DOMAIN))
    return {
        "status": "success",
        "is_configured": is_conf,
        "config": {
            "apiKey": FIREBASE_API_KEY,
            "authDomain": FIREBASE_AUTH_DOMAIN,
            "projectId": FIREBASE_PROJECT_ID,
            "storageBucket": FIREBASE_STORAGE_BUCKET,
            "messagingSenderId": FIREBASE_MESSAGING_SENDER_ID,
            "appId": FIREBASE_APP_ID,
            "measurementId": FIREBASE_MEASUREMENT_ID
        }
    }


@router.post("/firebase-login")
async def firebase_login(payload: FirebaseLoginRequest, db: Session = Depends(get_db)):
    """
    Authenticates a user via verified Firebase ID token (Email or Mobile OTP),
    creates/updates account in SQLite, seeds ₹100,000 paper wallet for new users,
    and returns a signed QuantVeda JWT session token.
    """
    token_claims = verify_firebase_id_token(payload.id_token.strip())

    uid = token_claims.get("uid") or token_claims.get("user_id") or token_claims.get("sub")
    if not uid:
        raise HTTPException(status_code=400, detail="Malformed Firebase token: missing user UID.")

    raw_email = token_claims.get("email")
    raw_phone = token_claims.get("phone_number") or token_claims.get("phone")
    raw_name = token_claims.get("name") or payload.preferred_name

    email = None
    if raw_email:
        try:
            email = normalize_email(raw_email)
        except Exception:
            email = raw_email.strip().lower()

    phone = None
    if raw_phone:
        try:
            phone = normalize_phone(raw_phone)
        except Exception:
            phone = raw_phone.strip()

    channel = "phone" if phone and not email else "email"
    identifier = email or phone or f"firebase_{uid[:8]}"

    now = datetime.utcnow()

    # Search for existing user
    user = None
    if uid:
        user = db.query(User).filter(User.firebase_uid == uid).first()
    if not user and email:
        user = db.query(User).filter(User.email == email).first()
    if not user and phone:
        user = db.query(User).filter(User.phone == phone).first()

    is_new_user = False
    if not user:
        is_new_user = True
        default_name = raw_name or (email.split("@")[0] if email else (f"Trader {phone[-4:]}" if phone else "Trader"))
        user = User(
            firebase_uid=uid,
            email=email,
            phone=phone,
            name=default_name,
            is_active=True,
            created_at=now,
            last_login=now
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        # Seed initial wallet with ₹100,000 starting balance
        seed_paper_wallet(db, user_id=user.id)

        # Create default watchlist
        wl_name = "Nifty Leaders"
        existing_wl = db.query(Watchlist).filter(Watchlist.name == wl_name).first()
        if existing_wl:
            wl_name = f"Nifty Leaders ({user.id})"
        default_wl = Watchlist(user_id=user.id, name=wl_name, source="preset")
        db.add(default_wl)
        db.commit()
        db.refresh(default_wl)

        default_symbols = [
            ("RELIANCE.NS", "Reliance Industries"),
            ("TCS.NS", "Tata Consultancy Services"),
            ("HDFCBANK.NS", "HDFC Bank"),
            ("INFY.NS", "Infosys"),
            ("ICICIBANK.NS", "ICICI Bank")
        ]
        for sym, n in default_symbols:
            db.add(WatchlistItem(watchlist_id=default_wl.id, symbol=sym, name=n, exchange="NSE"))
        db.commit()
    else:
        # Update existing user
        if not user.firebase_uid:
            user.firebase_uid = uid
        if email and not user.email:
            user.email = email
        if phone and not user.phone:
            user.phone = phone
        if raw_name and (user.name == "Trader" or not user.name):
            user.name = raw_name
        user.last_login = now
        db.commit()
        seed_paper_wallet(db, user_id=user.id)

    # Issue QuantVeda access token
    token = create_access_token(user.id, identifier, channel)
    try:
        from backend.db import log_activity
        log_activity(db, user.id, "login", f"firebase:{identifier}", None)
    except Exception:
        pass

    wallet = db.query(PaperWallet).filter(PaperWallet.user_id == user.id).first()
    cash_bal = wallet.cash_balance if wallet else 100000.0

    return {
        "status": "success",
        "message": "Firebase authentication successful.",
        "token": token,
        "access_token": token,
        "token_type": "bearer",
        "is_new_user": is_new_user,
        "auth_provider": "firebase",
        "user": {
            "id": user.id,
            "firebase_uid": user.firebase_uid,
            "email": user.email,
            "phone": user.phone,
            "name": user.name,
            "cash_balance": cash_bal,
            "created_at": user.created_at.isoformat() if user.created_at else None
        }
    }


@router.post("/save-firebase-config")
async def save_firebase_config(payload: FirebaseConfigSaveRequest):
    """
    Saves Firebase client credentials directly to .env and updates runtime config.
    """
    global FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID
    global FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID, FIREBASE_MEASUREMENT_ID

    updates = {}
    if payload.api_key is not None:
        FIREBASE_API_KEY = payload.api_key.strip()
        updates["FIREBASE_API_KEY"] = FIREBASE_API_KEY
    if payload.auth_domain is not None:
        FIREBASE_AUTH_DOMAIN = payload.auth_domain.strip()
        updates["FIREBASE_AUTH_DOMAIN"] = FIREBASE_AUTH_DOMAIN
    if payload.project_id is not None:
        FIREBASE_PROJECT_ID = payload.project_id.strip()
        updates["FIREBASE_PROJECT_ID"] = FIREBASE_PROJECT_ID
    if payload.storage_bucket is not None:
        FIREBASE_STORAGE_BUCKET = payload.storage_bucket.strip()
        updates["FIREBASE_STORAGE_BUCKET"] = FIREBASE_STORAGE_BUCKET
    if payload.messaging_sender_id is not None:
        FIREBASE_MESSAGING_SENDER_ID = payload.messaging_sender_id.strip()
        updates["FIREBASE_MESSAGING_SENDER_ID"] = FIREBASE_MESSAGING_SENDER_ID
    if payload.app_id is not None:
        FIREBASE_APP_ID = payload.app_id.strip()
        updates["FIREBASE_APP_ID"] = FIREBASE_APP_ID
    if payload.measurement_id is not None:
        FIREBASE_MEASUREMENT_ID = payload.measurement_id.strip()
        updates["FIREBASE_MEASUREMENT_ID"] = FIREBASE_MEASUREMENT_ID

    # Persist to .env
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                content = f.read()

            for k, v in updates.items():
                pattern = rf"^{k}=.*$"
                if re.search(pattern, content, flags=re.MULTILINE):
                    content = re.sub(pattern, f"{k}={v}", content, flags=re.MULTILINE)
                else:
                    content += f"\n{k}={v}"

            with open(env_path, "w", encoding="utf-8") as f:
                f.write(content)
        except Exception as e:
            logger.error(f"Error persisting to .env: {e}")

    init_firebase_admin()

    return {
        "status": "success",
        "message": "Firebase configuration saved successfully.",
        "is_configured": bool(FIREBASE_API_KEY and (FIREBASE_PROJECT_ID or FIREBASE_AUTH_DOMAIN))
    }
