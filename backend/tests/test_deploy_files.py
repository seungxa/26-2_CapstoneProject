"""Deploy files for the Oracle ARM server (scripts/practice-track/deploy). No server, root or network here:
install.sh runs in --files-only mode into a temporary prefix, and the templates are checked as text."""
import os
import re
import stat
import subprocess
from pathlib import Path

import pytest

from app.config import BASE_DIR, Settings

DEPLOY = BASE_DIR.parent / "scripts" / "practice-track" / "deploy"
DOMAIN = "example.duckdns.org"


def install(prefix: Path, *args: str) -> subprocess.CompletedProcess:
    env = {"PATH": os.environ["PATH"], "HOME": str(prefix), "JOBSEEKER_PREFIX": str(prefix)}
    return subprocess.run(["bash", str(DEPLOY / "install.sh"), "--files-only", *args],
                          env=env, capture_output=True, text=True, timeout=60)


def placed(prefix: Path) -> dict[str, Path]:
    return {"caddy": prefix / "etc/caddy/Caddyfile",
            "unit": prefix / "etc/systemd/system/jobseeker-api.service",
            "env": prefix / "etc/jobseeker/api.env"}


def test_files_only_places_the_files(tmp_path):
    r = install(tmp_path, DOMAIN)
    assert r.returncode == 0, r.stderr
    files = placed(tmp_path)
    assert all(f.is_file() for f in files.values())
    assert stat.S_IMODE(files["env"].stat().st_mode) == 0o640
    assert files["env"].read_text() == (DEPLOY / "api.env.example").read_text()


def test_caddyfile_has_the_domain_and_long_write_idle(tmp_path):
    assert install(tmp_path, DOMAIN).returncode == 0
    caddy = placed(tmp_path)["caddy"].read_text()
    for part in (f"{DOMAIN} {{", "reverse_proxy 127.0.0.1:8000", "write_idle 10m", "max_size 30MB"):
        assert part in caddy
    assert "@DOMAIN@" not in caddy


def test_rerun_keeps_a_filled_env_file(tmp_path):
    assert install(tmp_path, DOMAIN).returncode == 0
    env = placed(tmp_path)["env"]
    env.write_text("DATABASE_URL=postgresql://filled\n")
    r = install(tmp_path, DOMAIN)
    assert r.returncode == 0, r.stderr
    assert env.read_text() == "DATABASE_URL=postgresql://filled\n"


@pytest.mark.parametrize("args", [(), ("Bad Domain",), ("http://x.duckdns.org",), ("x",), ("-x.duckdns.org",)])
def test_bad_or_missing_domain_is_refused(tmp_path, args):
    r = install(tmp_path, *args)
    assert r.returncode == 2
    assert "usage" in r.stderr.lower() or "domain" in r.stderr.lower()
    assert not (tmp_path / "etc").exists()


def test_a_full_run_needs_root_and_no_prefix(tmp_path):
    """Without --files-only the script installs packages and services: never with a test prefix or as a user."""
    env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path), "JOBSEEKER_PREFIX": str(tmp_path)}
    r = subprocess.run(["bash", str(DEPLOY / "install.sh"), DOMAIN], env=env, capture_output=True, text=True, timeout=60)
    assert r.returncode == 2
    assert not (tmp_path / "etc").exists()


def test_service_unit_restarts_and_starts_at_boot():
    unit = (DEPLOY / "jobseeker-api.service").read_text()
    for line in ("User=jobseeker", "EnvironmentFile=/etc/jobseeker/api.env", "Restart=on-failure",
                 "WantedBy=multi-user.target", "ReadWritePaths=/var/lib/jobseeker",
                 "WorkingDirectory=/opt/jobseeker/backend"):
        assert re.search(rf"^{re.escape(line)}$", unit, re.M), line
    environment = " ".join(re.findall(r"^Environment=(.*)$", unit, re.M))
    assert "HF_HOME=/var/lib/jobseeker/hf" in environment
    [start] = re.findall(r"^ExecStart=(.*)$", unit, re.M)
    assert start.startswith("/opt/jobseeker/backend/.venv/bin/uvicorn app.main:app")
    assert "--host 127.0.0.1 --port 8000 --workers 1" in start


def _template() -> dict[str, str]:
    pairs = {}
    for line in (DEPLOY / "api.env.example").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            key, value = line.split("=", 1)
            pairs[key] = value
    return pairs


def test_env_template_names_are_settings():
    source = (BASE_DIR / "app" / "config.py").read_text()
    known = set(re.findall(r'env\.get\("([A-Z0-9_]+)"', source)) | set(re.findall(r'_number\(env, "([A-Z0-9_]+)"', source))
    assert set(_template()) <= known, set(_template()) - known


FAKE = {"SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "service-role-key",
        "DATABASE_URL": "postgresql://postgres.ref:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres",
        "CORS_ORIGINS": "https://team.example.app"}


def test_env_template_passes_the_production_check():
    env = _template()
    placeholders = {k for k, v in env.items() if "<" in v}
    assert placeholders == set(FAKE), placeholders  # exactly the values the team gives, nothing else to fill
    s = Settings({**env, **FAKE})
    s.check()
    assert s.app_env == "production" and s.auth_disabled is False and s.jwt_mode == "jwks"
    assert s.followup_preload is True and s.local_stt_preload is True
    assert s.followup_model == "local" and s.stt_provider == "local"
    assert s.practice_insights_enabled is False
    assert s.database_url.startswith("postgresql+psycopg://")
    assert not any("localhost" in o or "127.0.0.1" in o for o in s.cors_origins)
