"""Supabase Storage credentials: the legacy service_role key is a JWT and goes in both headers; a new secret key
(sb_secret_…) is not a JWT, and Supabase rejects it in Authorization: Bearer, so it goes in apikey only."""
from app import storage
from app.config import settings

LEGACY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl"


def test_legacy_service_role_key_is_sent_in_both_headers(monkeypatch):
    monkeypatch.setattr(settings, "supabase_service_key", LEGACY)
    assert storage._sb_headers() == {"Authorization": f"Bearer {LEGACY}", "apikey": LEGACY}


def test_new_secret_key_is_sent_as_apikey_only(monkeypatch):
    monkeypatch.setattr(settings, "supabase_service_key", "sb_secret_abc123")
    assert storage._sb_headers() == {"apikey": "sb_secret_abc123"}
