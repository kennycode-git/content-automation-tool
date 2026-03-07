"""
auth.py

JWT authentication middleware using Supabase-issued JWTs.

Security considerations:
- Supports both HS256 (legacy) and ES256 (current Supabase default) JWTs.
  ES256 tokens are verified against Supabase's public JWKS endpoint — no shared
  secret needed, and the private key never leaves Supabase.
- JWKS keys are cached in memory for the process lifetime (keys rotate rarely).
- The secret is never returned to the client. It's read from environment only.
- We extract user_id (sub claim) and expose it via get_current_user_id() dependency.
  Downstream handlers use this value for all DB queries — never a user-supplied ID.
- exp claim validation is handled by python-jose automatically (raises JWTError on expiry).
- Token is expected in Authorization: Bearer <token> header only (no cookie fallback
  to avoid CSRF surface on a stateless API).
"""

import logging
import os
from functools import lru_cache

import requests as http_requests
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwk as jose_jwk, jwt

logger = logging.getLogger(__name__)

_bearer = HTTPBearer()

@lru_cache(maxsize=1)
def _get_jwks() -> dict:
    supabase_url = os.environ.get("SUPABASE_URL", "")
    url = f"{supabase_url}/auth/v1/.well-known/jwks.json"
    print("FETCHING JWKS from:", url)
    resp = http_requests.get(url, timeout=10)
    print("JWKS RESPONSE:", resp.status_code, resp.text[:200])
    resp.raise_for_status()
    keys = resp.json().get("keys", [])
    return {k["kid"]: k for k in keys}


def _decode_token(token: str) -> dict:
    """Verify a Supabase JWT (HS256 or ES256) and return its payload."""
    try:
        header = jwt.get_unverified_header(token)
        print("TOKEN HEADER: ", header)
    except JWTError as exc:
        raise JWTError(f"Malformed token header: {exc}") from exc

    alg = header.get("alg", "HS256")

    if alg == "HS256":
        secret = os.environ.get("SUPABASE_JWT_SECRET", "")
        if not secret:
            raise RuntimeError("SUPABASE_JWT_SECRET must be set in environment.")
        return jwt.decode(token, secret, algorithms=["HS256"], options={"verify_aud": False})

    if alg == "ES256":
        kid = header.get("kid", "")
        jwks = _get_jwks()
        key_data = jwks.get(kid)
        if not key_data:
            # Cache may be stale — clear and retry once
            _get_jwks.cache_clear()
            jwks = _get_jwks()
            key_data = jwks.get(kid)
        if not key_data:
            raise JWTError(f"No public key found for kid={kid!r}")
        public_key = jose_jwk.construct(key_data)
        return jwt.decode(token, public_key, algorithms=["ES256"], options={"verify_aud": False})

    raise JWTError(f"Unsupported JWT algorithm: {alg!r}")


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    """
    FastAPI dependency: validates Bearer JWT and returns the user's UUID (sub claim).

    Usage:
        @router.get("/protected")
        async def endpoint(user_id: str = Depends(get_current_user_id)):
            ...
    """
    token = credentials.credentials
    try:
        payload = _decode_token(token)
        user_id: str = payload.get("sub", "")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing sub claim.",
            )
        return user_id
    except HTTPException:
        raise
    except JWTError as exc:
        logger.warning("JWT validation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        )
    except Exception as exc:
        logger.exception("Unexpected error during JWT validation: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication error.",
        )
