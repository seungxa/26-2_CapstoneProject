#!/usr/bin/env python3
"""Check the API's connection to its Supabase project. Read-only: nothing is written to the database or Storage.

On the server:
    sudo /opt/jobseeker/backend/.venv/bin/python /opt/jobseeker/scripts/practice-track/check_supabase.py \\
      --env-file /etc/jobseeker/api.env
On a PC with the backend set up: cd backend && .venv/bin/python ../scripts/practice-track/check_supabase.py --env-file <file>

Checks the settings, the database connection, the app's tables and columns, the app's own startup checks, row level
security, the private recordings bucket, and how sign-in tokens are verified. Every line starts with PASS, WARN, FAIL
or SKIP; the exit code is 1 when any line is FAIL. Keys and passwords are never printed.
Guide: docs/practice-track/supabase-apply.md
"""
import argparse
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "backend"
TIMEOUT_SEC = 10
_POOLER_HINT = ("; the direct db.<ref>.supabase.co address is IPv6 only on the free plan: "
                "use the Session pooler address (Connect -> Session pooler)")


def load_env_file(path: str) -> dict[str, str]:
    """KEY=VALUE lines like a systemd EnvironmentFile: comments and blank lines skipped, one pair of quotes removed."""
    values = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def _scrub(message: str, *secrets: str | None) -> str:
    first = (message.strip().splitlines() or [""])[0]
    for secret in secrets:
        if secret:
            first = first.replace(secret, "***")
    return first[:200]


def _database(settings, engine) -> tuple[list[tuple[str, str]], bool]:
    from sqlalchemy import text
    from sqlalchemy.engine import make_url

    url = make_url(settings.database_url)
    lines = []
    if url.get_backend_name() == "sqlite":
        lines.append(("FAIL", "database: DATABASE_URL is empty or SQLite: the app would use a local SQLite file, "
                              "not Supabase"))
    try:
        with engine.connect() as conn:
            query = "select version()" if engine.dialect.name == "postgresql" else "select sqlite_version()"
            version = conn.execute(text(query)).scalar_one()
    except Exception as e:
        hint = _POOLER_HINT if (url.host or "").startswith("db.") and (url.host or "").endswith(".supabase.co") else ""
        reason = _scrub(str(getattr(e, "orig", None) or e), url.password)
        lines.append(("FAIL", f"database: cannot connect to {url.host or 'the database'} ({reason}){hint}"))
        return lines, False
    lines.append(("PASS", f"database: connected ({' '.join(str(version).split()[:2])})"))
    return lines, True


def _schema(settings, engine) -> list[tuple[str, str]]:
    from sqlalchemy import inspect, text

    from app import models  # noqa: F401  registers the app's tables on Base.metadata
    from app.db import Base, validate_insights_schema, validate_track_schema

    inspector = inspect(engine)
    existing = set(inspector.get_table_names())
    missing = []
    for table in Base.metadata.sorted_tables:
        if table.name not in existing:
            missing.append(table.name)
            continue
        columns = {c["name"] for c in inspector.get_columns(table.name)}
        missing += [f"{table.name}.{c.name}" for c in table.columns if c.name not in columns]
    count = len(Base.metadata.sorted_tables)
    lines = [("FAIL", f"tables: missing {', '.join(missing[:10])}{' …' if len(missing) > 10 else ''}; "
                      "apply the schema (supabase-apply.md)") if missing
             else ("PASS", f"tables: all {count} app tables and their columns are present")]
    checks = [("app startup check (Track)", validate_track_schema)]
    if settings.practice_insights_enabled:
        checks.append(("app startup check (PRACTICE_INSIGHTS_ENABLED)", validate_insights_schema))
    for name, check in checks:
        try:
            check(engine)
            lines.append(("PASS", f"{name}: passes"))
        except RuntimeError as e:
            lines.append(("FAIL", f"{name}: {e}"))
    if engine.dialect.name != "postgresql":
        lines.append(("SKIP", "row level security: only checked on PostgreSQL"))
        return lines
    with engine.connect() as conn:
        rows = conn.execute(text("select c.relname, c.relrowsecurity from pg_class c "
                                 "where c.relnamespace = 'public'::regnamespace and c.relname = any(:names)"),
                            {"names": [t.name for t in Base.metadata.sorted_tables]}).all()
    off = sorted(name for name, enabled in rows if not enabled)
    lines.append(("FAIL", f"row level security: off on {', '.join(off)}; signed-in users could read others' rows")
                 if off else ("PASS", "row level security: on for every app table"))
    return lines


def _storage(settings, http) -> tuple[str, str]:
    from app.storage import _sb_headers

    if not (settings.supabase_url and settings.supabase_service_key):
        return "FAIL", ("storage: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is empty: recordings would be kept on the "
                        "server disk")
    bucket = settings.storage_bucket
    try:
        reply = http.get(f"{settings.supabase_url}/storage/v1/bucket/{bucket}",
                         headers=_sb_headers(settings.supabase_service_key), timeout=TIMEOUT_SEC)
    except Exception as e:
        return "FAIL", f"storage: no reply from {settings.supabase_url} ({type(e).__name__})"
    if reply.status_code == 200:
        if reply.json().get("public"):
            return "FAIL", (f"storage: bucket {bucket} is public: anyone with a file link can read recordings; "
                            "make it private in Storage")
        return "PASS", f"storage: bucket {bucket} exists and is private"
    if reply.status_code in (401, 403):
        return "FAIL", "storage: the project refused the service key; check SUPABASE_SERVICE_ROLE_KEY"
    if reply.status_code == 404 or "not found" in reply.text.lower():
        return "FAIL", f"storage: bucket {bucket} does not exist; schema.sql adds it as a private bucket"
    return "FAIL", f"storage: unexpected reply {reply.status_code} for bucket {bucket}"


def _sign_in(settings, http) -> tuple[str, str]:
    if settings.jwt_mode == "hs256":
        return (("PASS", "sign-in: HS256 secret is set") if settings.jwt_secret
                else ("FAIL", "sign-in: SUPABASE_JWT_MODE=hs256 needs SUPABASE_JWT_SECRET"))
    url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
    try:
        reply = http.get(url, timeout=TIMEOUT_SEC)
        keys = reply.json().get("keys", []) if reply.status_code == 200 else []
    except Exception as e:
        return "FAIL", f"sign-in: no reply from {url} ({type(e).__name__})"
    if not keys:
        return "FAIL", ("sign-in: the project publishes no signing keys, so it signs with the legacy JWT secret: "
                        "set SUPABASE_JWT_MODE=hs256 and SUPABASE_JWT_SECRET")
    algorithms = ", ".join(sorted({str(k.get("alg", "?")) for k in keys}))
    return "PASS", f"sign-in: {len(keys)} signing key(s) published ({algorithms})"


def run_checks(settings, engine, http) -> list[tuple[str, str]]:
    """(grade, sentence) lines. `engine` is the database to read and `http` the client for Supabase Storage and Auth."""
    from app.config import ConfigError

    try:
        settings.check()
        lines = [("PASS", "settings: complete")]
    except ConfigError as e:
        lines = [("FAIL", f"settings: {e}")]
    database, connected = _database(settings, engine)
    lines += database
    if connected:
        lines += _schema(settings, engine)
    else:
        lines += [("SKIP", "tables: no database connection"), ("SKIP", "row level security: no database connection")]
    lines.append(_storage(settings, http))
    lines.append(_sign_in(settings, http))
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--env-file", required=True, help="the API's settings file, for example /etc/jobseeker/api.env")
    args = parser.parse_args(argv)
    os.environ.update(load_env_file(args.env_file))  # before the app reads its settings
    sys.path.insert(0, str(BACKEND))
    import httpx
    from sqlalchemy import create_engine

    from app.config import settings

    url = settings.database_url
    engine = create_engine(url, connect_args={} if url.startswith("sqlite") else {"connect_timeout": TIMEOUT_SEC})
    with httpx.Client() as http:
        lines = run_checks(settings, engine, http)
    for grade, text in lines:
        print(f"{grade:4}  {text}")
    return 1 if any(grade == "FAIL" for grade, _ in lines) else 0


if __name__ == "__main__":
    sys.exit(main())
