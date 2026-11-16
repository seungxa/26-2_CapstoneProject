"""supabase/precheck.sql on a real PostgreSQL (auth/storage emulated, see conftest.py): the verdict for each state a
team project can be in, and proof that it only reads."""
import re

from conftest import ROOT

PRECHECK = ROOT / "supabase/precheck.sql"
APP_TABLES = ["questions", "practice_sessions", "practice_answers", "applications", "stage_events", "essay_items",
              "answer_versions", "user_settings", "practice_private_questions", "practice_contexts", "answer_coaching",
              "question_competencies", "application_states", "essay_submissions"]


def precheck(db) -> list[tuple[str, str, str, str]]:
    """Run the precheck inside a read-only transaction: any write would raise."""
    with db.connect() as conn:
        conn.execute("begin transaction read only")
        rows = conn.execute(PRECHECK.read_text()).fetchall()
        conn.execute("rollback")
    return rows


def verdict(rows) -> str:
    first = rows[0]
    assert first[0] == "verdict", first
    return first[2]


def tables(rows) -> dict[str, tuple[str, str]]:
    return {item: (status, detail) for section, item, status, detail in rows if section == "table"}


def test_bootstrap_only_is_new(cluster):
    rows = precheck(cluster.database(schema="bootstrap"))
    assert verdict(rows) == "NEW"
    assert "schema.sql" in rows[0][3]
    assert tables(rows) == {t: ("absent", "") for t in APP_TABLES}


def test_after_schema_is_upgrade(cluster):
    rows = precheck(cluster.database())
    assert verdict(rows) == "UPGRADE"
    assert "migrations" in rows[0][3] and "Do not run schema.sql" in rows[0][3]
    assert {status for status, _ in tables(rows).values()} == {"ours"}
    [(status, detail)] = [(s, d) for sec, item, s, d in rows if sec == "storage" and item == "bucket recordings"]
    assert status == "present" and "private" in detail


def test_after_schema_and_migrations_is_upgrade_and_rls_on(database):
    rows = precheck(database)
    assert verdict(rows) == "UPGRADE"
    assert all(detail == "RLS on" for _, detail in tables(rows).values()), tables(rows)


def test_historical_schema_is_upgrade(cluster):
    rows = precheck(cluster.database("historical"))
    assert verdict(rows) == "UPGRADE"
    assert tables(rows)["user_settings"][0] == "absent"  # created by a migration


def test_other_table_with_an_app_name_stops(cluster):
    db = cluster.database(schema="bootstrap")
    with db.connect() as conn:
        conn.execute("create table public.applications(id bigint primary key, title text)")
    rows = precheck(db)
    assert verdict(rows) == "STOP"
    status, detail = tables(rows)["applications"]
    assert status == "CONFLICT" and "user_id" in detail


def test_partial_base_tables_stop(cluster):
    db = cluster.database()
    with db.connect() as conn:
        conn.execute("drop table stage_events cascade")
    assert verdict(precheck(db)) == "STOP"


def test_taken_policy_or_function_name_stops_a_new_project(cluster):
    db = cluster.database(schema="bootstrap")
    with db.connect() as conn:
        conn.execute("create policy rec_own on storage.objects for select using (true)")
    assert verdict(precheck(db)) == "STOP"
    db = cluster.database(schema="bootstrap")
    with db.connect() as conn:
        conn.execute("create function public.protect_answer_version_history() returns int language sql as 'select 1'")
    assert verdict(precheck(db)) == "STOP"


def test_profiles_is_reported_not_judged(cluster):
    db = cluster.database(schema="bootstrap")
    with db.connect() as conn:
        conn.execute("create table public.profiles(user_id uuid primary key, archive jsonb)")
        conn.execute("alter table public.profiles enable row level security")
    rows = precheck(db)
    assert verdict(rows) == "NEW"
    [(status, detail)] = [(s, d) for sec, item, s, d in rows if sec == "profiles"]
    assert status == "present" and "user_id, archive" in detail and "RLS on" in detail


def test_precheck_is_one_read_only_select():
    # without comments and string literals (the output text has semicolons and plain words in it)
    body = re.sub(r"'(?:[^']|'')*'", "''", re.sub(r"--[^\n]*", "", PRECHECK.read_text())).strip()
    assert re.match(r"(?i)^(with|select)\b", body)
    assert body.count(";") == 1 and body.endswith(";")
    assert not re.search(r"(?i)\b(insert|update|delete|create|alter|drop|grant|revoke|truncate|comment)\b", body)


# ───────── scripts/practice-track/check_supabase.py on real PostgreSQL ─────────

def _check_lines(db):
    import importlib.util

    import httpx
    from sqlalchemy import create_engine

    from app.config import Settings

    spec = importlib.util.spec_from_file_location("check_supabase", ROOT / "scripts/practice-track/check_supabase.py")
    tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tool)
    settings = Settings({"APP_ENV": "production", "AUTH_DISABLED": "false", "SUPABASE_URL": "https://abc.supabase.co",
                         "SUPABASE_JWT_MODE": "hs256", "SUPABASE_JWT_SECRET": "s",
                         "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_key", "DATABASE_URL": db.url})
    no_network = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"public": False})))
    return tool.run_checks(settings, create_engine(db.url), no_network)


def test_check_supabase_on_migrated_postgres(database):
    lines = _check_lines(database)
    assert [line for grade, line in lines if grade == "FAIL"] == [], lines
    assert ("PASS", "row level security: on for every app table") in lines
    assert any(grade == "PASS" and line.startswith("tables: all") for grade, line in lines)


def test_rls_off_fails(database):
    with database.connect() as conn:
        conn.execute("alter table applications disable row level security")
    failed = [line for grade, line in _check_lines(database) if grade == "FAIL"]
    assert any("row level security" in line and "alter table public.applications enable row level security" in line
               for line in failed), failed


def test_rls_off_in_an_applied_project_names_the_fix(database):
    with database.connect() as conn:
        conn.execute("alter table applications disable row level security")
    rows = precheck(database)
    assert verdict(rows) == "UPGRADE"
    status, detail = tables(rows)["applications"]
    assert status == "ours" and "alter table public.applications enable row level security" in detail


def test_missing_bucket_in_an_applied_project_points_to_the_guide(cluster):
    db = cluster.database()
    with db.connect() as conn:
        conn.execute("delete from storage.buckets where id = 'recordings'")
    [(status, detail)] = [(s, d) for sec, item, s, d in precheck(db) if sec == "storage" and item == "bucket recordings"]
    assert status == "absent" and "supabase-apply.md" in detail
