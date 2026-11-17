import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { label, langOf } from "../labels";
import { ddayText, todayLocal } from "../components/track/dday";
import { dayLabel } from "../components/track/format";
import type { CalendarItem, FunnelRow, Stats } from "../types";

const UPCOMING_KIND: Partial<Record<CalendarItem["kind"], string>> = { deadline: "Deadline", next_step: "Next step" };

/** The last 12 months up to this one (YYYY-MM), oldest first, with their counts (0 for a month with none) */
function lastMonths(counts: { month: string; count: number }[], today: string): { month: string; count: number }[] {
  const byMonth = new Map(counts.map((c) => [c.month, c.count]));
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return Array.from({ length: 12 }, (_, i) => {
    const index = year * 12 + (month - 1) - (11 - i);
    const key = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
    return { month: key, count: byMonth.get(key) ?? 0 };
  });
}
const monthShort = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });

function MonthBars({ rows }: { rows: { month: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="month-bars" role="img" aria-label={rows.map((r) => `${monthShort(r.month)} ${r.count}`).join(", ")}>
      {rows.map((r) => (
        <div key={r.month} className="month-bar" data-testid="month-bar" data-count={r.count}>
          <span className="month-n">{r.count}</span>
          <div className="month-fill" style={{ height: `${(r.count / max) * 100}%` }} />
          <span className="month-l">{monthShort(r.month)}</span>
        </div>
      ))}
    </div>
  );
}

const pct = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)}%`);
/** pending counts both results still waiting and applications on hold; the screen shows them apart */
const waiting = (r: FunnelRow) => r.pending - (r.hold ?? 0);

/** 단계별 도달 건수 막대(단일 계열). 마우스를 올리면 통과·탈락·대기 내역을 보여준다. */
function Funnel({ rows }: { rows: FunnelRow[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.reached));
  return (
    <div className="bars stats-funnel" onMouseLeave={() => setTip(null)}>
      {rows.map((r) => (
        <div key={r.stage} className="bar-row"
          onMouseMove={(e) => setTip({ x: e.clientX + 12, y: e.clientY + 12, text: `${label("stage", r.stage)}\nReached ${r.reached}\nPassed ${r.passed} · Rejected ${r.failed} · Pending ${waiting(r)} · On Hold ${r.hold ?? 0}\nPass rate ${pct(r.pass_rate)}` })}>
          <span>{label("stage", r.stage)}</span>
          <div className="bar-bg"><div className="bar" style={{ width: `${(r.reached / max) * 100}%` }} /></div>
          <span className="muted">{r.reached} reached{r.pass_rate == null ? "" : ` · ${pct(r.pass_rate)} passed`}</span>
        </div>
      ))}
      {tip && <div className="tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
    </div>
  );
}

export default function StatsPage() {
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const ids = useId();
  useEffect(() => {
    api.stats().then(setS).catch((e) => setErr(e.message));
  }, []);
  if (err) return <p className="err">{err}</p>;
  if (!s) return <p className="muted">Loading…</p>;
  if (s.total === 0) return <><h1>Stats</h1><p className="muted">Add an application to see stats here.</p></>;

  const decided = s.status["합격"] + s.status["불합격"];
  const today = todayLocal();
  const months = lastMonths(s.applied_monthly ?? [], today);
  const upcoming = s.upcoming ?? [];
  const toResult = s.days_to_first_result ?? { median: null, count: 0 };
  return (
    <>
      <h1>Stats</h1>
      <div className="tiles">
        <div className="tile"><div className="v">{s.total}</div><div className="l">Applications</div></div>
        <div className="tile"><div className="v">{s.status["진행중"]}</div><div className="l">{label("status", "진행중")}</div></div>
        <div className="tile"><div className="v" style={{ color: "var(--good)" }}>{s.status["합격"]}</div><div className="l"><span aria-hidden="true">✓ </span>{label("status", "합격")}</div></div>
        <div className="tile"><div className="v" style={{ color: "var(--bad)" }}>{s.status["불합격"]}</div><div className="l"><span aria-hidden="true">✕ </span>{label("status", "불합격")}</div></div>
        <div className="tile"><div className="v">{decided ? pct(s.status["합격"] / decided) : "–"}</div><div className="l">Pass Rate</div></div>
        <div className="tile" data-testid="days-to-result">
          <div className="v">{toResult.median ?? "–"}</div>
          <div className="l">Days to First Result{toResult.count ? ` (${toResult.count} results)` : ""}</div>
        </div>
      </div>

      <section className="card" aria-labelledby={`${ids}-next`}>
        <h2 id={`${ids}-next`}>Next 14 Days</h2>
        {upcoming.length === 0 ? <p className="muted">Nothing due in the next 14 days</p> : (
          <ul className="upcoming">
            {upcoming.map((u, i) => (
              <li key={`${u.application_id}-${u.kind}-${i}`}>
                <span className="chip due">{ddayText(u.date, today)}</span>
                <span className="muted nowrap">{dayLabel(u.date)}</span>
                <span>{UPCOMING_KIND[u.kind] ?? u.kind}</span>
                <Link to={`/track/${u.application_id}`} lang={langOf(u.company)}>{u.company}</Link>
                {u.label && <span lang={langOf(u.label)}>{u.label}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>By Stage</h2>
          <button className="small" onClick={() => setTable(!table)}>{table ? "Show Chart" : "Show Table"}</button>
        </div>
        <div className="spacer" />
        {table ? (
          <div className="table-scroll"><table>
            <thead><tr><th>Stage</th><th>Reached</th><th>Passed</th><th>Rejected</th><th>Pending</th><th>On Hold</th><th>Pass Rate</th></tr></thead>
            <tbody>{s.funnel.map((r) => <tr key={r.stage}><td>{label("stage", r.stage)}</td><td>{r.reached}</td><td>{r.passed}</td><td>{r.failed}</td><td>{waiting(r)}</td><td>{r.hold ?? 0}</td><td>{pct(r.pass_rate)}</td></tr>)}</tbody>
          </table></div>
        ) : (
          <Funnel rows={s.funnel} />
        )}
        <p className="small muted">Pass rate = passed ÷ (passed + rejected). Results still pending or on hold aren't counted.</p>
      </section>

      <section className="card" aria-labelledby={`${ids}-month`}>
        <h2 id={`${ids}-month`}>By Month</h2>
        <p className="small muted">Last 12 months by date applied{s.undated_count ? ` · ${s.undated_count} with no date` : ""}</p>
        <MonthBars rows={months} />
      </section>

      <section className="card" aria-labelledby={`${ids}-job`}>
        <h2 id={`${ids}-job`}>By Job</h2>
        <div className="bars job-pass">
          {s.by_job_category.map((c) => (
            <div key={c.job_category} className="bar-row" data-testid="job-pass">
              <span>{label("job", c.job_category)}</span>
              <div className="bar-bg"><div className="bar good" style={{ width: `${c.total ? (c.final_pass / c.total) * 100 : 0}%` }} /></div>
              <span className="muted">{c.final_pass}/{c.total} passed · {c.total ? pct(c.final_pass / c.total) : "–"}</span>
            </div>
          ))}
        </div>
        <p className="small muted">Stage columns show the pass rate.</p>
        <div className="table-scroll"><table>
          <thead>
            <tr><th>Job</th><th>Total</th>{s.funnel.map((r) => <th key={r.stage}>{label("stage", r.stage)}</th>)}<th>Passed</th></tr>
          </thead>
          <tbody>
            {s.by_job_category.map((c) => (
              <tr key={c.job_category}>
                <td>{label("job", c.job_category)}</td>
                <td>{c.total}</td>
                {c.funnel.map((r) => <td key={r.stage} title={`Passed ${r.passed} · Rejected ${r.failed} · Pending ${waiting(r)} · On Hold ${r.hold ?? 0}`}>{pct(r.pass_rate)}</td>)}
                <td>{c.final_pass}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
