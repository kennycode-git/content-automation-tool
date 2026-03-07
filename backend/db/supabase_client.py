"""
supabase_client.py

Supabase client singleton.

Security considerations:
- Uses the SERVICE_ROLE key (server-side only, never exposed to frontend).
- The anon key is only used in the frontend via VITE_SUPABASE_ANON_KEY.
- Client is created once at startup and reused (thread-safe for async use).
- SUPABASE_URL and SUPABASE_SERVICE_KEY must be set as environment variables;
  the app will refuse to start if they are missing.
"""

import os
from functools import lru_cache

from supabase import create_client, Client


@lru_cache(maxsize=1)
def get_client() -> Client:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in environment. "
            "Never commit these values to source control."
        )
    return create_client(url, key)
