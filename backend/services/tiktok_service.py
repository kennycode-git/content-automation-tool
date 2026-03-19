"""
tiktok_service.py

TikTok OAuth + Content Posting API wrapper.

HMAC-signed state prevents CSRF: state = base64(user_id:timestamp), signed with TIKTOK_CLIENT_SECRET.
FILE_UPLOAD strategy: download MP4 from Supabase to tempfile, upload bytes to TikTok.
"""

import base64
import hashlib
import hmac
import logging
import os
import tempfile
import time
import urllib.parse
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

TIKTOK_AUTH_BASE = "https://www.tiktok.com/v2/auth/authorize/"
TIKTOK_API_BASE = "https://open.tiktokapis.com"
SCOPES = "user.info.basic,video.publish"


def _get_secret() -> str:
    secret = os.environ.get("TIKTOK_CLIENT_SECRET", "")
    if not secret:
        raise RuntimeError("TIKTOK_CLIENT_SECRET not set")
    return secret


def _sign_state(payload: str) -> str:
    """Return HMAC-SHA256 hex digest of payload."""
    return hmac.new(
        _get_secret().encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()


def build_auth_url(user_id: str) -> str:
    """Build TikTok OAuth URL with HMAC-signed state."""
    client_key = os.environ.get("TIKTOK_CLIENT_KEY", "")
    redirect_uri = os.environ.get("TIKTOK_REDIRECT_URI", "")
    if not client_key or not redirect_uri:
        raise RuntimeError("TIKTOK_CLIENT_KEY and TIKTOK_REDIRECT_URI must be set")

    timestamp = int(time.time())
    payload = f"{user_id}:{timestamp}"
    raw_state = base64.urlsafe_b64encode(payload.encode()).decode()
    sig = _sign_state(raw_state)
    state = f"{raw_state}.{sig}"

    params = {
        "client_key": client_key,
        "scope": SCOPES,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "state": state,
    }
    return f"{TIKTOK_AUTH_BASE}?{urllib.parse.urlencode(params)}"


def verify_state(state: str) -> str:
    """Verify HMAC state and return user_id. Raises ValueError if invalid or >10min old."""
    try:
        raw_state, sig = state.rsplit(".", 1)
    except ValueError:
        raise ValueError("Malformed state parameter")

    expected = _sign_state(raw_state)
    if not hmac.compare_digest(sig, expected):
        raise ValueError("State signature invalid")

    payload = base64.urlsafe_b64decode(raw_state.encode()).decode()
    user_id, ts_str = payload.split(":", 1)
    if time.time() - int(ts_str) > 600:
        raise ValueError("State expired")
    return user_id


def exchange_code(code: str) -> dict:
    """Exchange OAuth code for tokens. Returns token + user info dict."""
    client_key = os.environ.get("TIKTOK_CLIENT_KEY", "")
    client_secret = _get_secret()
    redirect_uri = os.environ.get("TIKTOK_REDIRECT_URI", "")

    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{TIKTOK_API_BASE}/v2/oauth/token/",
            data={
                "client_key": client_key,
                "client_secret": client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        data = resp.json()

    if data.get("error"):
        raise ValueError(f"TikTok token error: {data.get('error_description', data.get('error'))}")

    access_token = data["access_token"]
    try:
        profile = get_creator_info(access_token)
    except Exception:
        profile = {}

    return {
        "open_id": data["open_id"],
        "access_token": access_token,
        "refresh_token": data.get("refresh_token"),
        "expires_in": data.get("expires_in", 86400),
        "scope": data.get("scope", ""),
        "display_name": profile.get("display_name"),
        "avatar_url": profile.get("avatar_url"),
    }


def get_creator_info(access_token: str) -> dict:
    """Fetch TikTok creator profile (display_name, avatar_url, open_id)."""
    with httpx.Client(timeout=30) as client:
        resp = client.get(
            f"{TIKTOK_API_BASE}/v2/user/info/",
            params={"fields": "display_name,avatar_url,open_id"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        data = resp.json()

    user_data = data.get("data", {}).get("user", {})
    return {
        "display_name": user_data.get("display_name"),
        "avatar_url": user_data.get("avatar_url"),
        "open_id": user_data.get("open_id"),
    }


def refresh_access_token(refresh_token: str) -> dict:
    """Exchange refresh token for new access token. Returns updated token dict."""
    client_key = os.environ.get("TIKTOK_CLIENT_KEY", "")
    client_secret = _get_secret()

    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{TIKTOK_API_BASE}/v2/oauth/token/",
            data={
                "client_key": client_key,
                "client_secret": client_secret,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        data = resp.json()

    if data.get("error"):
        raise ValueError(f"TikTok refresh error: {data.get('error_description', data.get('error'))}")

    return {
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token"),
        "expires_in": data.get("expires_in", 86400),
    }


def get_valid_token(account: dict) -> str:
    """
    Return a valid access_token for the given account dict.
    If the token expires within 5 minutes, refresh it and update the DB row.
    """
    from db.supabase_client import get_client

    expires_at_str = account.get("token_expires_at")
    if expires_at_str:
        expires_at = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
        if expires_at < datetime.now(timezone.utc) + timedelta(minutes=5):
            new_tokens = refresh_access_token(account["refresh_token"])
            new_expires = (
                datetime.now(timezone.utc) + timedelta(seconds=new_tokens["expires_in"])
            ).isoformat()
            get_client().table("tiktok_accounts").update({
                "access_token": new_tokens["access_token"],
                "refresh_token": new_tokens.get("refresh_token") or account["refresh_token"],
                "token_expires_at": new_expires,
            }).eq("id", account["id"]).execute()
            return new_tokens["access_token"]

    return account["access_token"]


def post_video(
    access_token: str,
    video_url: str,
    caption: str,
    privacy_level: str = "PUBLIC_TO_EVERYONE",
    draft: bool = False,
) -> str:
    """
    Upload video to TikTok using FILE_UPLOAD strategy.
    draft=True  → /v2/post/publish/inbox/video/init/ (saves as TikTok draft, requires video.upload scope)
    draft=False → /v2/post/publish/video/init/ (direct post, requires video.publish scope)
    Returns publish_id.
    """
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp_path = tmp.name
    try:
        # Download the video
        with httpx.Client(timeout=120, follow_redirects=True) as client:
            with client.stream("GET", video_url) as resp:
                resp.raise_for_status()
                for chunk in resp.iter_bytes(chunk_size=1024 * 1024):
                    tmp.write(chunk)
        tmp.close()

        video_size = os.path.getsize(tmp_path)
        if video_size == 0:
            raise ValueError("Downloaded video is empty")

        # Initialise upload
        if draft:
            init_url = f"{TIKTOK_API_BASE}/v2/post/publish/inbox/video/init/"
            init_body = {
                "source_info": {
                    "source": "FILE_UPLOAD",
                    "video_size": video_size,
                    "chunk_size": video_size,
                    "total_chunk_count": 1,
                },
            }
            logger.info("TikTok draft mode: saving to inbox")
        else:
            init_url = f"{TIKTOK_API_BASE}/v2/post/publish/video/init/"
            init_body = {
                "post_info": {
                    "title": caption[:150] if caption else "",
                    "privacy_level": privacy_level,
                    "disable_duet": False,
                    "disable_comment": False,
                    "disable_stitch": False,
                },
                "source_info": {
                    "source": "FILE_UPLOAD",
                    "video_size": video_size,
                    "chunk_size": video_size,
                    "total_chunk_count": 1,
                },
            }

        with httpx.Client(timeout=30) as client:
            init_resp = client.post(
                init_url,
                json=init_body,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json; charset=UTF-8",
                },
            )
            init_resp.raise_for_status()
            init_data = init_resp.json()

        err = init_data.get("error", {})
        if err.get("code", "ok") != "ok":
            raise ValueError(f"TikTok init error: {err}")

        publish_id = init_data["data"]["publish_id"]
        upload_url = init_data["data"]["upload_url"]

        # Upload the video bytes
        with open(tmp_path, "rb") as f:
            video_bytes = f.read()

        with httpx.Client(timeout=300) as client:
            upload_resp = client.put(
                upload_url,
                content=video_bytes,
                headers={
                    "Content-Type": "video/mp4",
                    "Content-Range": f"bytes 0-{video_size - 1}/{video_size}",
                    "Content-Length": str(video_size),
                },
            )
            upload_resp.raise_for_status()

        logger.info("TikTok video uploaded, publish_id=%s", publish_id)
        return publish_id

    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
