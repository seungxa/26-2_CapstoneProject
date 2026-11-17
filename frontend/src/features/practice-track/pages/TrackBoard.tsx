import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { groupByStage, moveTarget } from "../components/track/board";
import { DueChip } from "../components/track/DueChip";
import { todayLocal } from "../components/track/dday";
import { StatusChip } from "../components/track/StatusChip";
import { label, langOf } from "../labels";
import { STAGES, STATUSES, type Application, type Stage, type Status } from "../types";

/** Applications as cards in one column per stage. A card moves by dragging or by its arrow buttons (keyboard and
 *  touch); the screen changes at once and goes back if the server refuses */
export default function TrackBoard() {
  const [apps, setApps] = useState<Application[] | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const dragged = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    api.applications().then((list) => { if (active) setApps(list); }).catch((e) => { if (active) setErr(e.message); });
    return () => { active = false; };
  }, []);

  const change = async (app: Application, patch: { stage?: Stage; status?: Status }) => {
    if (busy.has(app.id)) return;
    setErr(null);
    setBusy((b) => new Set(b).add(app.id));
    setApps((list) => list && list.map((a) => (a.id === app.id ? { ...a, ...patch } : a)));
    try {
      const next = await api.updateApplication(app.id, patch);
      setApps((list) => list && list.map((a) => (a.id === app.id ? { ...a, ...next } : a)));
    } catch (e) {
      setApps((list) => list && list.map((a) => (a.id === app.id ? app : a)));
      setErr((e as Error).message);
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(app.id); return n; });
    }
  };

  if (!apps) return err ? <p className="err" role="alert">{err}</p> : <p className="muted">Loading…</p>;
  const { columns, closed } = groupByStage(apps, showClosed);
  const today = todayLocal();

  return (
    <>
      <div className="row page-head">
        <h1 className="grow">Board</h1>
        {closed > 0 && (
          <button aria-pressed={showClosed} onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? "Hide closed" : `Show closed (${closed})`}
          </button>
        )}
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      {apps.length === 0 ? (
        <section className="card"><p className="muted">Add an application first. <Link to="/track">Applications</Link></p></section>
      ) : (
        <div className="board">
          {STAGES.map((stage) => (
            <section key={stage} className={`board-col${over === stage ? " over" : ""}`} aria-label={label("stage", stage)}
              onDragOver={(e) => { if (dragged.current) { e.preventDefault(); setOver(stage); } }}
              onDragLeave={() => setOver((o) => (o === stage ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const app = apps.find((a) => a.id === dragged.current);
                dragged.current = null;
                if (app && app.stage !== stage) void change(app, { stage });
              }}>
              <h2>{label("stage", stage)} <span className="muted">{columns[stage].length}</span></h2>
              {columns[stage].length === 0 && <p className="muted small">No applications</p>}
              {columns[stage].map((app) => {
                const back = moveTarget(app.stage, -1);
                const next = moveTarget(app.stage, 1);
                const locked = busy.has(app.id);
                return (
                  <article key={app.id} className="board-card" aria-label={`${app.company} · ${app.position}`} draggable={!locked}
                    onDragStart={(e) => { dragged.current = app.id; e.dataTransfer.setData("text/plain", app.id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { dragged.current = null; setOver(null); }}>
                    <Link to={`/track/${app.id}`} className="board-title" lang={langOf(app.company)}>{app.company}</Link>
                    <span className="small muted" lang={langOf(app.position)}>{app.position}</span>
                    <div className="row board-chips"><StatusChip status={app.status} /><DueChip app={app} today={today} /></div>
                    <div className="row board-actions">
                      {back && <button className="small" aria-label="Move to previous stage" disabled={locked} onClick={() => void change(app, { stage: back })}>←</button>}
                      <select aria-label="Status" value={app.status} disabled={locked} onChange={(e) => void change(app, { status: e.target.value as Status })}>
                        {STATUSES.map((s) => <option key={s} value={s}>{label("status", s)}</option>)}
                      </select>
                      {next && <button className="small" aria-label="Move to next stage" disabled={locked} onClick={() => void change(app, { stage: next })}>→</button>}
                    </div>
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
