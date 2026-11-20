import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { label, sessionKind } from "../labels";
import type { SessionSummary, PracticeTaxonomy } from "../types";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export default function SessionList() {
  const nav = useNavigate();
  const [taxonomy,setTaxonomy]=useState<PracticeTaxonomy|null>(null);
  const [competency,setCompetency]=useState("");
  useEffect(()=>{api.taxonomy().then(setTaxonomy).catch(()=>{});},[]);
  const [rows, setRows] = useState<SessionSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.sessions().then(setRows).catch((e) => setErr(e.message));
  }, []);
  if (err) return <p className="err">{err}</p>;
  if (!rows) return <p className="muted">Loading…</p>;
  const shown = rows.filter(r=>!competency||r.competency_keys?.includes(competency));
  return (
    <>
      <h1>History</h1>
      {taxonomy?.enabled&&rows.length>0&&<select className="history-filter" aria-label="Filter by skill" value={competency} onChange={e=>setCompetency(e.target.value)}><option value="">All Skills</option>{taxonomy.competencies.map(c=><option value={c.key} key={c.key}>{label("competency", c.key)}</option>)}</select>}
      <div className="card table-scroll">
        {rows.length === 0 ? (
          <p className="muted">No practice sessions yet.</p>
        ) : shown.length === 0 ? (
          <p className="muted">No sessions match.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Session</th><th>Recorded</th><th>Avg. Self-Rating</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="click" onClick={() => nav(`/practice/sessions/${r.id}`)}>
                  <td>
                    <Link to={`/practice/sessions/${r.id}`}>{sessionKind(r)} · {when(r.created_at)}</Link>
                    {!r.finished_at && <span className="chip" style={{ marginLeft: 6 }}>In Progress</span>}
                    {taxonomy?.enabled&&(!!r.competency_keys?.length||!!r.classification_missing_count)&&<div className="row small">{r.competency_keys?.map(k=><span className="chip" key={k}>{label("competency", k)}</span>)}{!!r.classification_missing_count&&<span className="muted">{r.classification_missing_count} untagged</span>}</div>}
                  </td>
                  <td>{r.recorded_count} / {r.answer_count}</td>
                  <td>{r.avg_rating != null ? `★ ${r.avg_rating.toFixed(1)}` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
