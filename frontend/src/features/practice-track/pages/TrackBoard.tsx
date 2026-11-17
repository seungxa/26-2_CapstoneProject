import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const [announce, setAnnounce] = useState("");
  // After a move the card is rendered in another column: put focus back on the control that was used
  const refocus = useRef<{ id: string; act: string } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const target = refocus.current;
    if (!target || !boardRef.current) return;
    refocus.current = null;
    const cardEl = boardRef.current.querySelector<HTMLElement>(`[data-card="${target.id}"]`);
    (cardEl?.querySelector<HTMLElement>(`[data-act="${target.act}"]`) ?? cardEl?.querySelector<HTMLElement>("select"))?.focus();
  }, [apps]);

  useEffect(() => {
    let active = true;
    api.applications().then((list) => { if (active) setApps(list); }).catch((e) => { if (active) setErr(e.message); });
    return () => { active = false; };
  }, []);

  const busyNow = useRef(new Set<string>());
  const change = async (app: Application, patch: { stage?: Stage; status?: Status }, act?: string) => {
    if (busyNow.current.has(app.id)) return;
    busyNow.current.add(app.id);
    setErr(null);
    setBusy((b) => new Set(b).add(app.id));
    setApps((list) => list && list.map((a) => (a.id === app.id ? { ...a, ...patch } : a)));
    try {
      const next = await api.updateApplication(app.id, patch);
      if (act) refocus.current = { id: app.id, act };
      setApps((list) => list && list.map((a) => (a.id === app.id ? { ...a, ...next } : a)));
      if (patch.stage) setAnnounce(`Moved ${app.company} to ${label("stage", patch.stage)}`);
      else if (patch.status) setAnnounce(`${app.company}: ${label("status", patch.status)}`);
    } catch (e) {
      setApps((list) => list && list.map((a) => (a.id === app.id ? app : a)));
      setErr((e as Error).message);
    } finally {
      busyNow.current.delete(app.id);
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
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      {apps.length === 0 ? (
        <section className="card"><p className="muted">Add an application first. <Link to="/track">Applications</Link></p></section>
      ) : (
        <div className="board" ref={boardRef}>
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
                  <article key={app.id} data-card={app.id} className="board-card" aria-label={`${app.company} · ${app.position}`} draggable={!locked}
                    onDragStart={(e) => { dragged.current = app.id; e.dataTransfer.setData("text/plain", app.id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { dragged.current = null; setOver(null); }}>
                    <Link to={`/track/${app.id}`} className="board-title" lang={langOf(app.company)}>{app.company}</Link>
                    <span className="small muted" lang={langOf(app.position)}>{app.position}</span>
                    <div className="row board-chips"><StatusChip status={app.status} /><DueChip app={app} today={today} /></div>
                    <div className="row board-actions">
                      {back && <button className="small" aria-label="Move to previous stage" data-act="back" disabled={locked} onClick={() => void change(app, { stage: back }, "back")}>←</button>}
                      <select aria-label="Status" data-act="status" value={app.status} disabled={locked} onChange={(e) => void change(app, { status: e.target.value as Status }, "status")}>
                        {STATUSES.map((s) => <option key={s} value={s}>{label("status", s)}</option>)}
                      </select>
                      {next && <button className="small" aria-label="Move to next stage" data-act="next" disabled={locked} onClick={() => void change(app, { stage: next }, "next")}>→</button>}
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
