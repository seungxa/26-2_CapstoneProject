import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { updatedLabel } from "../components/track/format";
import { StatusChip } from "../components/track/StatusChip";
import { DueChip } from "../components/track/DueChip";
import { todayLocal } from "../components/track/dday";
import { label, langOf } from "../labels";
import { JOB_CATEGORIES, STAGES, STATUSES, type Application } from "../types";

const EMPTY = { company: "", position: "", job_category: "개발", url: "", applied_at: "" };
// Option values stay the stored (Korean) values the API and the extension use; only the text is English
const jobOptions = JOB_CATEGORIES.map((j) => <option key={j} value={j}>{label("job", j)}</option>);

export default function TrackList() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Application[]>([]);
  const [f, setF] = useState<{ status: string; stage: string; job_category: string; q: string; sort: "recent" | "due" }>({ status: "", stage: "", job_category: "", q: "", sort: "recent" });
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const creating = useRef(false);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [createErr, setCreateErr] = useState<string | null>(null);

  // 필터를 빨리 바꾸면 응답 순서가 뒤바뀔 수 있다: 가장 나중에 보낸 조회의 응답만 반영한다
  const latest = useRef(0);
  const load = () => {
    const mine = ++latest.current;
    api.applications(f)
      .then((r) => { if (mine === latest.current) { setRows(r); setErr(null); } })
      .catch((e) => { if (mine === latest.current) setErr(e.message); });
  };
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [f.status, f.stage, f.job_category, f.q, f.sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    if (creating.current) return;
    creating.current = true;
    setPending(true);
    setCreateErr(null);
    try {
      const a = await api.createApplication({
        company: form.company,
        position: form.position,
        job_category: form.job_category,
        url: form.url || null,
        applied_at: form.applied_at || null,
      });
      nav(`/track/${a.id}`);
    } catch (e) {
      setCreateErr((e as Error).message);
    } finally {
      creating.current = false;
      setPending(false);
    }
  };
  const cancel = () => { setOpen(false); setForm(EMPTY); setCreateErr(null); };

  const folded = (f.stage ? 1 : 0) + (f.job_category ? 1 : 0);
  const today = todayLocal();
  const filtered = !!(f.q || f.status || folded);

  return (
    <>
      <div className="row page-head">
        <h1 className="grow">Applications</h1>
        <button className="primary" aria-expanded={open} onClick={() => (open ? cancel() : setOpen(true))}><span aria-hidden="true">+ </span>Add Application</button>
      </div>
      {open && (
        <section className="card" aria-label="New application">
          <div className="row">
            <label className="grow">Company<input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label>
            <label className="grow">Role<input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></label>
            <label>Job
              <select value={form.job_category} onChange={(e) => setForm({ ...form, job_category: e.target.value })}>{jobOptions}</select>
            </label>
            <label>Date applied<input type="date" value={form.applied_at} onChange={(e) => setForm({ ...form, applied_at: e.target.value })} /></label>
          </div>
          <div className="spacer" />
          <div className="row bottom">
            <label className="grow">Job posting URL<input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></label>
            <button className="primary" disabled={pending || !form.company.trim() || !form.position.trim()} onClick={create}>Save</button>
            <button onClick={cancel}>Cancel</button>
          </div>
          {createErr && <p className="err" role="alert">{createErr}</p>}
        </section>
      )}
      <section className="card">
        <div className="row list-tools">
          <input type="search" className="list-search" aria-label="Search company or role" placeholder="Search company or role" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          <select aria-label="Filter by status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">All Statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{label("status", s)}</option>)}
          </select>
          <select aria-label="Sort" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value as "recent" | "due" })}>
            <option value="recent">Recently updated</option>
            <option value="due">Due soon</option>
          </select>
          <details className="fold list-filters">
            <summary>Filters{folded ? ` (${folded})` : ""}</summary>
            <div className="row">
              <select aria-label="Filter by stage" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>
                <option value="">All Stages</option>
                {STAGES.map((s) => <option key={s} value={s}>{label("stage", s)}</option>)}
              </select>
              <select aria-label="Filter by job" value={f.job_category} onChange={(e) => setF({ ...f, job_category: e.target.value })}>
                <option value="">All Jobs</option>
                {jobOptions}
              </select>
            </div>
          </details>
        </div>
        {err && <p className="err" role="alert">{err}</p>}
        {rows.length === 0 ? (
          <p className="muted">{filtered ? "No applications match." : "No applications yet. Add one, or save a posting with the Chrome extension."}</p>
        ) : (
          <div className="table-scroll"><table className="track-table">
            <thead>
              <tr><th>Company</th><th>Role</th><th>Stage</th><th>Status</th><th>Due</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="click" onClick={() => nav(`/track/${a.id}`)}>
                  <td><Link to={`/track/${a.id}`} lang={langOf(a.company)}>{a.company}</Link>{a.source === "extension" && <span className="chip" style={{ marginLeft: 6 }}>Extension</span>}</td>
                  <td lang={langOf(a.position)}>{a.position}</td>
                  <td>{label("stage", a.stage)}</td>
                  <td><StatusChip status={a.status} /></td>
                  <td className="nowrap"><DueChip app={a} today={today} /></td>
                  <td className="muted nowrap">{updatedLabel(a.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
