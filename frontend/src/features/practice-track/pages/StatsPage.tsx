import { useEffect, useState } from "react";
import { api } from "../api";
import { label } from "../labels";
import type { FunnelRow, Stats } from "../types";

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
  useEffect(() => {
    api.stats().then(setS).catch((e) => setErr(e.message));
  }, []);
  if (err) return <p className="err">{err}</p>;
  if (!s) return <p className="muted">Loading…</p>;
  if (s.total === 0) return <><h1>Stats</h1><p className="muted">Add an application to see stats here.</p></>;

  const decided = s.status["합격"] + s.status["불합격"];
  const months = s.applied_monthly ?? [];
  return (
    <>
      <h1>Stats</h1>
      <div className="tiles">
        <div className="tile"><div className="v">{s.total}</div><div className="l">Applications</div></div>
        <div className="tile"><div className="v">{s.status["진행중"]}</div><div className="l">{label("status", "진행중")}</div></div>
        <div className="tile"><div className="v" style={{ color: "var(--good)" }}>{s.status["합격"]}</div><div className="l"><span aria-hidden="true">✓ </span>{label("status", "합격")}</div></div>
        <div className="tile"><div className="v" style={{ color: "var(--bad)" }}>{s.status["불합격"]}</div><div className="l"><span aria-hidden="true">✕ </span>{label("status", "불합격")}</div></div>
        <div className="tile"><div className="v">{decided ? pct(s.status["합격"] / decided) : "–"}</div><div className="l">Pass Rate</div></div>
      </div>

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

      <section className="card">
        <h2>By Month</h2>
        <p className="small muted">By date applied{s.undated_count ? ` · ${s.undated_count} with no date` : ""}</p>
        {months.length === 0 ? <p className="muted">No dates yet.</p> : (
          <div className="table-scroll"><table>
            <tbody>{months.map((m) => <tr key={m.month}><td>{m.month}</td><td>{m.count}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section className="card">
        <h2>By Job</h2>
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
