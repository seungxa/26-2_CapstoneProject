"""scripts/practice-track/check_supabase.py without a real project: SQLite stands in for the database and
httpx.MockTransport for Supabase Storage and Auth. Real PostgreSQL checks are in integration/test_supabase_precheck.py."""
import importlib.util
import os
import subprocess
import sys

import httpx
import pytest
from sqlalchemy import create_engine, text

from app.config import BASE_DIR, Settings
from app.db import Base

SCRIPT = BASE_DIR.parent / "scripts" / "practice-track" / "check_supabase.py"
_spec = importlib.util.spec_from_file_location("check_supabase", SCRIPT)
check_supabase = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_supabase)

POOLER = "postgresql://postgres.abc:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres"
JWK = {"kty": "EC", "alg": "ES256", "kid": "k1", "crv": "P-256", "x": "x", "y": "y"}


def settings(**extra) -> Settings:
    env = {"APP_ENV": "production", "AUTH_DISABLED": "false", "SUPABASE_URL": "https://abc.supabase.co",
           "SUPABASE_JWT_MODE": "jwks", "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_key", "DATABASE_URL": POOLER}
    return Settings({**env, **extra})


def sqlite_engine(tmp_path, drop: str | None = None):
    engine = create_engine(f"sqlite:///{tmp_path / 'db.sqlite'}")
    Base.metadata.create_all(engine)
    if drop:
        with engine.begin() as conn:
            conn.execute(text(f"drop table {drop}"))
    return engine


def http(bucket=(200, {"id": "recordings", "public": False}), jwks=(200, {"keys": [JWK]})) -> httpx.Client:
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/storage/v1/bucket/recordings":
            return httpx.Response(bucket[0], json=bucket[1])
        if request.url.path == "/auth/v1/.well-known/jwks.json":
            return httpx.Response(jwks[0], json=jwks[1])
        return httpx.Response(404, json={})
    return httpx.Client(transport=httpx.MockTransport(handle))


def fails(lines) -> list[str]:
    return [line for grade, line in lines if grade == "FAIL"]


def test_env_file_parsing(tmp_path):
    f = tmp_path / "api.env"
    f.write_text('# comment\n\nA=1\nB="v a"\nC=\'x\'\nDATABASE_URL=postgresql://u:p@h/db?x=1\n  D = spaced \n')
    assert check_supabase.load_env_file(str(f)) == {
        "A": "1", "B": "v a", "C": "x", "DATABASE_URL": "postgresql://u:p@h/db?x=1", "D": "spaced"}


def test_sqlite_database_fails(tmp_path):
    lines = check_supabase.run_checks(settings(DATABASE_URL=""), sqlite_engine(tmp_path), http())
    assert any("SQLite" in line for line in fails(lines))


def test_complete_schema_and_private_bucket_pass(tmp_path):
    lines = check_supabase.run_checks(settings(), sqlite_engine(tmp_path), http())
    assert fails(lines) == [], lines
    assert ("SKIP" in [g for g, _ in lines])  # RLS is a PostgreSQL check
    assert any("private" in line for grade, line in lines if grade == "PASS")
    assert any("ES256" in line for grade, line in lines if grade == "PASS")


def test_missing_table_fails(tmp_path):
    lines = check_supabase.run_checks(settings(), sqlite_engine(tmp_path, drop="stage_events"), http())
    assert any("stage_events" in line for line in fails(lines))


def test_public_bucket_fails(tmp_path):
    lines = check_supabase.run_checks(settings(), sqlite_engine(tmp_path), http(bucket=(200, {"public": True})))
    assert any("public" in line.lower() for line in fails(lines))


@pytest.mark.parametrize("reply", [(404, {"error": "not found"}), (400, {"statusCode": "404", "error": "Bucket not found"})])
def test_missing_bucket_fails(tmp_path, reply):
    lines = check_supabase.run_checks(settings(), sqlite_engine(tmp_path), http(bucket=reply))
    assert any("schema.sql" in line for line in fails(lines))


def test_bad_service_key_fails(tmp_path):
    lines = check_supabase.run_checks(settings(), sqlite_engine(tmp_path), http(bucket=(401, {"message": "Invalid"})))
    assert any("service key" in line for line in fails(lines))


def test_no_service_key_means_recordings_on_disk(tmp_path):
    lines = check_supabase.run_checks(settings(SUPABASE_SERVICE_ROLE_KEY=""), sqlite_engine(tmp_path), http())
    assert any("server disk" in line for line in fails(lines))


def test_jwks_without_keys_suggests_hs256(tmp_path):
    lines = check_supabase.run_checks(settings(), sqlite_engine(tmp_path), http(jwks=(200, {"keys": []})))
    assert any("SUPABASE_JWT_MODE=hs256" in line for line in fails(lines))


def test_hs256_needs_only_the_secret(tmp_path):
    lines = check_supabase.run_checks(settings(SUPABASE_JWT_MODE="hs256", SUPABASE_JWT_SECRET="s"),
                                      sqlite_engine(tmp_path), http(jwks=(500, {})))
    assert fails(lines) == [], lines


def test_direct_address_failure_points_to_the_pooler(tmp_path):
    direct = "postgresql://postgres:pw@db.abc.supabase.co:5432/postgres"
    broken = create_engine(f"sqlite:///{tmp_path / 'missing' / 'no.sqlite'}")  # cannot be opened: like a failed connect
    lines = check_supabase.run_checks(settings(DATABASE_URL=direct), broken, http())
    assert any("Session pooler" in line for line in fails(lines))
    assert [g for g, line in lines if line.startswith("tables")] == ["SKIP"]


def test_output_never_shows_secrets(tmp_path):
    env_file = tmp_path / "api.env"
    env_file.write_text("APP_ENV=production\nAUTH_DISABLED=false\nSUPABASE_URL=http://127.0.0.1:9\n"
                        "SUPABASE_JWT_MODE=hs256\nSUPABASE_JWT_SECRET=jwt-TOPSECRET\n"
                        "SUPABASE_SERVICE_ROLE_KEY=sb_secret_TOPSECRET\n"
                        "DATABASE_URL=postgresql://postgres:pw-TOPSECRET@127.0.0.1:9/postgres\n")
    r = subprocess.run([sys.executable, str(SCRIPT), "--env-file", str(env_file)], capture_output=True, text=True,
                       timeout=60, env={"PATH": os.environ["PATH"], "HOME": str(tmp_path)})
    out = r.stdout + r.stderr
    assert r.returncode == 1, out
    assert "FAIL" in out and "TOPSECRET" not in out


def test_cli_compares_against_every_app_table(tmp_path):
    """Run as a command (a fresh process that has not imported the app's models): the check must still know
    every app table, or a database with none of them would pass."""
    empty = tmp_path / "empty.sqlite"
    create_engine(f"sqlite:///{empty}").connect().close()
    env_file = tmp_path / "api.env"
    env_file.write_text(f"AUTH_DISABLED=true\nDATABASE_URL=sqlite:///{empty}\n")
    r = subprocess.run([sys.executable, str(SCRIPT), "--env-file", str(env_file)], capture_output=True, text=True,
                       timeout=60, env={"PATH": os.environ["PATH"], "HOME": str(tmp_path)})
    tables = [line for line in r.stdout.splitlines() if "tables:" in line]
    assert tables and tables[0].startswith("FAIL") and "applications" in tables[0], r.stdout + r.stderr
