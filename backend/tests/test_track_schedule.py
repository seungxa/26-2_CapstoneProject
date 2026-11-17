"""Track schedule: deadlines and next steps, due-date sorting, the calendar feed and upcoming stats."""
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine, text

from app.routers.track import local_today  # noqa: E402

TODAY = local_today()  # the app's day (APP_TIMEZONE), not the test machine's


def user() -> dict:
    return {"X-User-Id": f"user-schedule-{uuid.uuid4()}"}


def day(n: int) -> str:
    return (TODAY + timedelta(days=n)).isoformat()


def new(client, h, company="카카오", **fields):
    r = client.post("/track/applications", headers=h,
                    json={"company": company, "position": "백엔드", "job_category": "개발", **fields})
    assert r.status_code == 201, r.text
    return r.json()


def test_schedule_fields_round_trip(client):
    h = user()
    a = new(client, h, deadline=day(5), next_step_on=day(9), next_step="  1차 면접 ")
    assert (a["deadline"], a["next_step_on"], a["next_step"]) == (day(5), day(9), "1차 면접")
    listed = client.get("/track/applications", headers=h).json()[0]
    assert (listed["deadline"], listed["next_step_on"], listed["next_step"]) == (day(5), day(9), "1차 면접")
    r = client.patch(f"/track/applications/{a['id']}", headers=h, json={"deadline": None, "next_step": "   "})
    assert r.status_code == 200, r.text
    assert (r.json()["deadline"], r.json()["next_step"], r.json()["next_step_on"]) == (None, None, day(9))
    r = client.patch(f"/track/applications/{a['id']}", headers=h, json={"next_step": "가" * 41})
    assert r.status_code == 422


def test_sort_due_orders_by_the_nearest_upcoming_date(client):
    h = user()
    later = new(client, h, "마감3일", deadline=day(3))
    soon = new(client, h, "면접1일", applied_at=day(-2), next_step_on=day(1), next_step="면접")
    nothing = new(client, h, "날짜없음")
    past = new(client, h, "지난마감", deadline=day(-1))
    done = new(client, h, "합격건", next_step_on=day(0))
    assert client.patch(f"/track/applications/{done['id']}", headers=h, json={"status": "합격"}).status_code == 200
    order = [a["company"] for a in client.get("/track/applications", params={"sort": "due"}, headers=h).json()]
    assert order[:2] == ["면접1일", "마감3일"]
    assert set(order[2:4]) == {"날짜없음", "지난마감"} and order[-1] == "합격건"
    assert {later["id"], soon["id"], nothing["id"], past["id"], done["id"]}  # all five came back
    assert len(order) == 5


def test_calendar_returns_only_mine_within_the_range(client):
    h, other = user(), user()
    a = new(client, h, "토스", applied_at=day(0), deadline=day(2), next_step_on=day(4), next_step="과제")
    new(client, h, "범위밖", deadline=day(40))
    new(client, other, "남의것", deadline=day(2))
    ev = client.post(f"/track/applications/{a['id']}/events", headers=h,
                     json={"stage": "서류", "result": "합격", "event_date": day(1)})
    assert ev.status_code == 201, ev.text
    items = client.get("/track/calendar", params={"start": day(0), "end": day(4)}, headers=h).json()
    assert [(i["date"], i["kind"], i["company"], i["label"]) for i in items] == [
        (day(0), "applied", "토스", ""), (day(1), "result", "토스", "서류 합격"),
        (day(2), "deadline", "토스", ""), (day(4), "next_step", "토스", "과제")]
    assert all(i["application_id"] == a["id"] for i in items)
    too_long = client.get("/track/calendar", params={"start": day(0), "end": day(62)}, headers=h)
    assert too_long.status_code == 422 and "62 days" in too_long.json()["detail"]
    backwards = client.get("/track/calendar", params={"start": day(2), "end": day(0)}, headers=h)
    assert backwards.status_code == 422


def test_calendar_month_edges(client):
    h = user()
    new(client, h, "1월말", deadline="2027-01-31")
    new(client, h, "윤일", next_step_on="2028-02-29")
    jan = client.get("/track/calendar", params={"start": "2027-01-01", "end": "2027-01-31"}, headers=h).json()
    assert [(i["date"], i["company"]) for i in jan] == [("2027-01-31", "1월말")]
    feb = client.get("/track/calendar", params={"start": "2028-02-01", "end": "2028-02-29"}, headers=h).json()
    assert [(i["date"], i["label"]) for i in feb] == [("2028-02-29", "Next step")]


def test_stats_upcoming_and_days_to_first_result(client):
    h = user()
    new(client, h, "곧마감", deadline=day(3))
    new(client, h, "면접", applied_at=day(-1), next_step_on=day(14), next_step="2차")
    new(client, h, "멀리", deadline=day(15))
    for company, gap in (("세일", 3), ("오일", 5)):
        a = new(client, h, company, applied_at=day(-20))
        r = client.post(f"/track/applications/{a['id']}/events", headers=h,
                        json={"stage": "서류", "result": "불합격", "event_date": day(-20 + gap)})
        assert r.status_code == 201, r.text
    s = client.get("/track/stats", headers=h).json()
    assert [(u["company"], u["kind"]) for u in s["upcoming"]] == [("곧마감", "deadline"), ("면접", "next_step")]
    assert s["days_to_first_result"] == {"median": 4.0, "count": 2}
    empty = client.get("/track/stats", headers=user()).json()
    assert empty["upcoming"] == [] and empty["days_to_first_result"] == {"median": None, "count": 0}


def test_sync_saves_deadline(client):
    h = user()
    body = {"company": "네이버", "position": "프론트", "url": f"https://example.com/{uuid.uuid4()}",
            "essays": [], "submitted": False}
    first = client.post("/track/sync", headers=h, json={**body, "deadline": day(7)}).json()
    app = client.get(f"/track/applications/{first['application_id']}", headers=h).json()
    assert app["deadline"] == day(7)
    client.post("/track/sync", headers=h, json=body)  # no deadline: keep it
    assert client.get(f"/track/applications/{first['application_id']}", headers=h).json()["deadline"] == day(7)
    client.post("/track/sync", headers=h, json={**body, "deadline": day(9)})
    assert client.get(f"/track/applications/{first['application_id']}", headers=h).json()["deadline"] == day(9)


@pytest.mark.parametrize("missing", ["deadline", "next_step_on", "next_step"])
def test_track_schema_requires_schedule_columns(tmp_path, missing):
    from app import models  # noqa: F401
    from app.db import Base, validate_track_schema

    engine = create_engine(f"sqlite:///{tmp_path / 'db.sqlite'}")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text(f"alter table applications drop column {missing}"))
    with pytest.raises(RuntimeError, match="20261117_track_schedule.sql"):
        validate_track_schema(engine)


def test_today_is_the_configured_zone_not_the_server_clock(monkeypatch):
    """The deployed server runs UTC; Korean users' day starts nine hours earlier."""
    from datetime import datetime, timezone

    from app.config import Settings, settings
    from app.routers import track

    assert Settings({}).app_timezone == "Asia/Seoul"
    monkeypatch.setattr(settings, "app_timezone", "Asia/Seoul")
    late_utc = datetime(2026, 11, 17, 23, 30, tzinfo=timezone.utc)
    assert track.local_today(late_utc) == date(2026, 11, 18)
    monkeypatch.setattr(settings, "app_timezone", "UTC")
    assert track.local_today(late_utc) == date(2026, 11, 17)


def test_a_bad_timezone_is_a_startup_error():
    from app.config import ConfigError, Settings

    with pytest.raises(ConfigError, match="APP_TIMEZONE"):
        Settings({"AUTH_DISABLED": "true", "APP_TIMEZONE": "Mars/Base"}).check()


def test_a_result_dated_before_applying_is_left_out_of_days_to_first_result(client):
    h = user()
    a = new(client, h, "앞선결과", applied_at=day(-5))
    r = client.post(f"/track/applications/{a['id']}/events", headers=h, json={"stage": "서류", "result": "불합격", "event_date": day(-9)})
    assert r.status_code == 201, r.text
    assert client.get("/track/stats", headers=h).json()["days_to_first_result"] == {"median": None, "count": 0}
