#!/usr/bin/env python3
"""Check a deployed JobSeeker practice API on its server. Python standard library only (runs with system python3).

    python3 /opt/jobseeker/scripts/practice-track/deploy/check_server.py --domain <name>.duckdns.org --origin <team web>

Checks, in order: the API on 127.0.0.1:8000, the same over https on the domain, a CORS preflight from the team web
address, and memory use (a 4 GB server close to full may stop a model or the API).
Every line starts with PASS, WARN, FAIL or SKIP. Exit code 1 when any line is FAIL.
"""
import argparse
import json
import ssl
import sys
import urllib.error
import urllib.request

LOCAL = "http://127.0.0.1:8000/health"
TIMEOUT_SEC = 10
FULL_MEMORY_PERCENT = 90
_AGAIN = "still loading; run this check again in a minute"


def _model(name: str, info: dict, local_mode: bool) -> tuple[str, str]:
    state, error = info.get("state"), info.get("error")
    if not local_mode:
        return "WARN", f"{name}: turned off on this server"
    if state == "error" or not info.get("available", True):
        return "FAIL", f"{name}: {error or 'not available'} (sudo journalctl -u jobseeker-api)"
    if state == "loading":
        return "WARN", f"{name}: {_AGAIN}"
    if state == "ready":
        return "PASS", f"{name}: loaded ({info.get('model')})"
    return "WARN", f"{name}: not loaded yet (state {state}); check that the PRELOAD settings are true"


def _memory(meminfo: str) -> tuple[str, str]:
    values = {}
    for line in meminfo.splitlines():
        key, _, rest = line.partition(":")
        parts = rest.split()
        if parts and parts[0].isdigit():
            values[key.strip()] = int(parts[0])
    total, available = values.get("MemTotal", 0), values.get("MemAvailable")
    if total <= 0 or available is None:
        return "WARN", "memory: could not read /proc/meminfo"
    used = round(100 * (total - available) / total)
    size = f"{total / 1048576:.1f} GB"
    if used >= FULL_MEMORY_PERCENT:
        return "WARN", (f"memory: {used}% of {size} in use, over {FULL_MEMORY_PERCENT}%. "
                        "Stop other programs, or pick a VM size with more memory")
    return "PASS", f"memory: {used}% of {size} in use"


def evaluate(health: dict, meminfo: str) -> list[tuple[str, str]]:
    """(grade, sentence) lines for one /health reply and the server's /proc/meminfo."""
    stt, followup = health.get("stt") or {}, health.get("followup") or {}
    return [
        ("FAIL", "sign-in: AUTH_DISABLED is true; set it to false in /etc/jobseeker/api.env")
        if health.get("auth_disabled") else ("PASS", "sign-in: required"),
        _model("speech model", stt, stt.get("provider") == "local"),
        _model("follow-up model", followup, followup.get("mode") == "local"),
        _memory(meminfo),
    ]


def _get(url: str, method: str = "GET", headers: dict | None = None):
    request = urllib.request.Request(url, method=method, headers=headers or {})
    return urllib.request.urlopen(request, timeout=TIMEOUT_SEC, context=ssl.create_default_context())


def _read_health(url: str, hint: str) -> tuple[tuple[str, str], dict | None]:
    try:
        with _get(url) as reply:
            return ("PASS", f"{url}: answers"), json.load(reply)
    except (urllib.error.URLError, OSError, ValueError) as e:
        return ("FAIL", f"{url}: {getattr(e, 'reason', e)}; {hint}"), None


def _cors(domain: str, origin: str) -> tuple[str, str]:
    headers = {"Origin": origin, "Access-Control-Request-Method": "GET"}
    try:
        with _get(f"https://{domain}/health", "OPTIONS", headers) as reply:
            allowed = reply.headers.get("Access-Control-Allow-Origin")
    except urllib.error.HTTPError as e:
        allowed = e.headers.get("Access-Control-Allow-Origin")
    except (urllib.error.URLError, OSError) as e:
        return "FAIL", f"CORS: no reply ({getattr(e, 'reason', e)})"
    if allowed == origin:
        return "PASS", f"CORS: {origin} may call the API"
    return "FAIL", f"CORS: {origin} is not allowed; add it to CORS_ORIGINS in /etc/jobseeker/api.env and restart"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--domain", required=True, help="the server's domain, for example myname.duckdns.org")
    parser.add_argument("--origin", help="the team web address that calls the API, for example https://team.app")
    args = parser.parse_args(argv)

    line, health = _read_health(LOCAL, "is the service running? sudo systemctl status jobseeker-api")
    lines = [line]
    public, _ = _read_health(f"https://{args.domain}/health",
                             "check that DuckDNS points to this server and ports 80/443 are open "
                             "(Azure: the VM's network security group, inbound 80 and 443); sudo journalctl -u caddy")
    lines.append(public)
    lines.append(_cors(args.domain, args.origin.rstrip("/")) if args.origin
                 else ("SKIP", "CORS: pass --origin <team web address> to check it"))
    if health is not None:
        try:
            with open("/proc/meminfo", encoding="ascii") as f:
                meminfo = f.read()
        except OSError:
            meminfo = ""
        lines += evaluate(health, meminfo)
    for grade, text in lines:
        print(f"{grade:4}  {text}")
    return 1 if any(grade == "FAIL" for grade, _ in lines) else 0


if __name__ == "__main__":
    sys.exit(main())
