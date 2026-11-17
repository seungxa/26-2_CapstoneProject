import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { byDate, monthGrid, monthTitle, shiftMonth, type YearMonth } from "../components/track/calendar";
import { todayLocal } from "../components/track/dday";
import { dayLabel } from "../components/track/format";
import { label as stored, langOf } from "../labels";
import type { CalendarItem } from "../types";

const KIND: Record<CalendarItem["kind"], string> = { applied: "Applied", deadline: "Deadline", next_step: "Next", result: "Result" };
const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHOWN = 3;

/** What a chip adds after its kind: the next step's name, or the stage and result in English */
function detail(item: CalendarItem): string {
  if (item.kind === "result") {
    const [stage, result] = item.label.split(" ");
    return `${stored("stage", stage)} ${stored("result", result)}`;
  }
  return item.kind === "next_step" ? item.label : "";
}

function Chip({ item }: { item: CalendarItem }) {
  const more = detail(item);
  return (
    <Link to={`/track/${item.application_id}`} className={`cal-chip ${item.kind}`} title={more || undefined}>
      {KIND[item.kind]} <span lang={langOf(item.company)}>{item.company}</span>
      {more && <span className="sr-only"> · {more}</span>}
    </Link>
  );
}

const thisMonth = (): YearMonth => {
  const today = todayLocal();
  return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
};

/** Month calendar of applied dates, deadlines, next steps and stage results. On a phone it lists the days that have items */
export default function TrackCalendar() {
  const [ym, setYm] = useState(thisMonth);
  const [items, setItems] = useState<CalendarItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const grid = monthGrid(ym.year, ym.month);
  const first = grid[0];
  const last = grid[grid.length - 1];

  useEffect(() => {
    let active = true;
    setItems(null);
    setErr(null);
    api.calendar(first, last).then((r) => { if (active) setItems(r); }).catch((e) => { if (active) setErr(e.message); });
    return () => { active = false; };
  }, [first, last]);

  const today = todayLocal();
  const prefix = `${ym.year}-${String(ym.month).padStart(2, "0")}`;
  const days = byDate(items ?? []);
  const monthDays = [...days.keys()].filter((d) => d.startsWith(prefix)).sort();

  return (
    <>
      <div className="row page-head">
        <h1 className="grow">Calendar</h1>
      </div>
      <section className="card">
        <div className="row cal-head">
          <button aria-label="Previous month" onClick={() => setYm((m) => shiftMonth(m, -1))}>‹</button>
          <button onClick={() => setYm(thisMonth())}>Today</button>
          <button aria-label="Next month" onClick={() => setYm((m) => shiftMonth(m, 1))}>›</button>
          <h2 className="grow" data-testid="calendar-title">{monthTitle(ym)}</h2>
        </div>
        {err && <p className="err" role="alert">{err}</p>}
        {items && monthDays.length === 0 && <p className="muted">Nothing this month</p>}
        <table className="calendar">
          <caption className="sr-only">{monthTitle(ym)}</caption>
          <thead><tr>{WEEK.map((d) => <th key={d} scope="col">{d}</th>)}</tr></thead>
          <tbody>
            {Array.from({ length: 6 }, (_, week) => (
              <tr key={week}>
                {grid.slice(week * 7, week * 7 + 7).map((date) => {
                  const list = days.get(date) ?? [];
                  const open = expanded.has(date);
                  return (
                    <td key={date} data-date={date} className={date.startsWith(prefix) ? "" : "out"} aria-current={date === today ? "date" : undefined}>
                      <span className="cal-day">{Number(date.slice(8))}</span>
                      {(open ? list : list.slice(0, SHOWN)).map((item, i) => <Chip key={`${item.application_id}-${item.kind}-${i}`} item={item} />)}
                      {!open && list.length > SHOWN && (
                        <button className="link small" onClick={() => setExpanded((s) => new Set(s).add(date))}>+{list.length - SHOWN} more</button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="cal-list" aria-label="Days with items">
          {monthDays.map((date) => (
            <li key={date} aria-current={date === today ? "date" : undefined}>
              <h3>{dayLabel(date)}</h3>
              {(days.get(date) ?? []).map((item, i) => <Chip key={`${item.application_id}-${item.kind}-${i}`} item={item} />)}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
