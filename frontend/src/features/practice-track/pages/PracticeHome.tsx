import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api } from "../api";
import { label } from "../labels";
import { essayPreview } from "../practice/essays";
import { questionsForApplication } from "../practice/questions";
import { ClassificationControls } from "../components/ClassificationControls";
import { CATEGORIES, JOB_CATEGORIES, type Application, type ApplicationDetail, type Category, type Question, type PracticeTaxonomy, type ClassificationInput } from "../types";

const SOURCES = [["bank", "Standard"], ["generated", "Generated"], ["custom", "Custom"]] as const;
/** Errors show next to the part of the screen whose action failed. */
type ErrorPlace = "questions" | "start" | "generate";

export default function PracticeHome() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [taxonomy,setTaxonomy]=useState<PracticeTaxonomy|null>(null);
  const [classification,setClassification]=useState<ClassificationInput>({});
  const [tagFilter,setTagFilter]=useState({type:'',keys:[] as string[],match:'any' as 'any'|'all'});
  const [editing,setEditing]=useState<string|null>(null);
  const [editTags,setEditTags]=useState<ClassificationInput>({});
  useEffect(()=>{api.taxonomy().then(setTaxonomy).catch(()=>{});},[]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [applicationId, setApplicationId] = useState(params.get("application") ?? "");
  const [applicationDetail, setApplicationDetail] = useState<ApplicationDetail | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setApplicationDetail(null); setPreviewError(null);
    if (applicationId) api.application(applicationId).then(a => {if(alive) setApplicationDetail(a);}).catch(e => {if(alive) setPreviewError(e.message);});
    return () => {alive=false;};
  }, [applicationId]);
  const [filter, setFilter] = useState({ category: "", job_category: "", source: "", q: "" });
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => { setSelected([]); }, [applicationId]);
  const [err, setErr] = useState<{ at: ErrorPlace; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [essayBasis, setEssayBasis] = useState<"submitted" | "latest">("submitted");
  const [jobDescription, setJobDescription] = useState("");
  const [followups, setFollowups] = useState(true);
  // Only shows or hides the custom question form.
  const [adding, setAdding] = useState(false);

  // 모의시험 설정
  const [mock, setMock] = useState({ count: 5, prep_sec: 30, answer_sec: 90, job_category: "" });
  const [mockCats, setMockCats] = useState<Category[]>(["인성", "직무", "기업", "상황"]);

  // 맞춤 질문 생성
  const [gen, setGen] = useState({
    company: "",
    position: "",
    job_category: "",
    essay_text: "",
    count: 5,
  });
  const [newQ, setNewQ] = useState<{ category: Category; text: string }>({ category: "인성", text: "" });

  // 필터가 바뀌거나 reload()가 호출되면 다시 불러온다. 늦게 온 이전 응답은 버린다.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  useEffect(() => {
    let alive = true;
    api.questions({ category: filter.category, job_category: filter.job_category, source: filter.source, ...(taxonomy?.enabled?{question_type:tagFilter.type?[tagFilter.type]:[],competency_key:tagFilter.keys,competency_match:tagFilter.match}:{}) })
      .then((qs) => alive && setQuestions(qs))
      .catch((e) => setErr({ at: "questions", text: e.message }));
    return () => {
      alive = false;
    };
  }, [filter.category, filter.job_category, filter.source, reloadKey, taxonomy, tagFilter]);
  useEffect(() => {
    api.applications().then(setApps).catch(() => {});
  }, []);

  const shown = useMemo(
    () => questionsForApplication(questions, applicationId).filter(q => !filter.q || q.text.includes(filter.q)),
    [questions, applicationId, filter.q],
  );
  const preview = useMemo(() => essayPreview(applicationDetail?.essay_items ?? [], essayBasis), [applicationDetail, essayBasis]);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  // Filters folded under More Options still narrow the list, so the list says when they are on.
  const foldedFilters = !!(filter.job_category || filter.source || (taxonomy?.enabled && (tagFilter.type || tagFilter.keys.length)));
  const clearFoldedFilters = () => {
    setFilter((f) => ({ ...f, job_category: "", source: "" }));
    setTagFilter((t) => ({ ...t, type: "", keys: [] }));
  };

  const run = async (at: ErrorPlace, fn: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr({ at, text: (e as Error).message });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const errorAt = (at: ErrorPlace) => err?.at === at ? <p className="err" role="alert">{err.text}</p> : null;

  const startFree = () =>
    run("start", async () => {
      const s = await api.createSession({ mode: "free", question_ids: selected,
        application_id: applicationId || undefined, essay_basis: essayBasis,
        job_description: jobDescription, followups_enabled: followups });
      nav(`/practice/sessions/${s.id}/run`);
    });

  const startMock = () =>
    run("start", async () => {
      const s = await api.createSession({
        mode: "mock",
        count: mock.count,
        prep_sec: mock.prep_sec,
        answer_sec: mock.answer_sec,
        categories: mockCats,
        job_category: mock.job_category || undefined,
        application_id: applicationId || undefined,
        essay_basis: essayBasis,
        job_description: jobDescription,
        followups_enabled: followups,
        ...(taxonomy?.enabled?{question_types:tagFilter.type?[tagFilter.type]:[],competency_keys:tagFilter.keys,competency_match:tagFilter.match}:{}),
      });
      nav(`/practice/sessions/${s.id}/run`);
    });

  const generate = () =>
    run("generate", async () => {
      const made = await api.generateQuestions({
        application_id: applicationId || undefined,
        ...(!applicationId ? {
          company: gen.company || undefined,
          position: gen.position || undefined,
          job_category: gen.job_category || undefined,
          essay_text: gen.essay_text || undefined,
        } : {}),
        count: gen.count,
        essay_basis: essayBasis,
      });
      if (made.length === 0) throw new Error("No new questions: they're all in your list already. Try a different essay.");
      setFilter((f) => ({ ...f, source: "generated", category: "" }));
      setSelected(made.map((q) => q.id));
      reload();
    });

  const addCustom = () =>
    run("questions", async () => {
      await api.addQuestion({ ...newQ, job_category: filter.job_category || null, ...(taxonomy?.enabled?classification:{}) });
      setNewQ({ ...newQ, text: "" });
      setAdding(false);
      reload();
    });

  const categoryOptions = CATEGORIES.map((c) => <option key={c} value={c}>{label("category", c)}</option>);
  const jobOptions = JOB_CATEGORIES.map((j) => <option key={j} value={j}>{label("job", j)}</option>);

  return (
    <div className="practice-start">
      <h1>Practice</h1>
      <section className="card" aria-labelledby="practice-questions-title">
        <div className="row q-head">
          <h2 id="practice-questions-title" className="grow">Questions</h2>
          <input type="search" className="q-search" placeholder="Search questions" aria-label="Search questions" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
          <select aria-label="Filter by category" value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
            <option value="">All Categories</option>
            {categoryOptions}
          </select>
        </div>
        {foldedFilters && <p className="small muted">Filters in More Options are on. <button className="link" onClick={clearFoldedFilters}>Clear Filters</button></p>}
        <ul className="qlist">
          {shown.map((q) => (
            <li key={q.id}>
              <input type="checkbox" checked={selected.includes(q.id)} onChange={() => toggle(q.id)} aria-label={`Select question: ${q.text}`} />
              <span className="q-text" lang="ko">{q.text}</span>
              <span className="q-end">
                <span className="chip">{label("category", q.category)}</span>
                {q.job_category && <span className="chip">{label("job", q.job_category)}</span>}
                {taxonomy?.enabled&&q.source!=="bank"&&<button aria-expanded={editing===q.id} onClick={()=>{setEditing(editing===q.id?null:q.id);setEditTags({question_type:q.question_type,competency_keys:q.competency_keys??[]});}}>Edit Tags</button>}
                {q.source !== "bank" && (
                  <button className="danger" disabled={busy} onClick={() => run("questions", async () => { await api.deleteQuestion(q.id); reload(); })}>Delete</button>
                )}
              </span>
              {editing===q.id&&<div className="q-panel"><ClassificationControls taxonomy={taxonomy} value={editTags} onChange={setEditTags} label="Tags"/><div className="row"><button disabled={busy} onClick={()=>run("questions", async()=>{await api.classifyQuestion(q.id,editTags);setEditing(null);reload();})}>Save</button><button onClick={()=>setEditing(null)}>Cancel</button></div></div>}
            </li>
          ))}
          {shown.length === 0 && <li className="muted">No questions match.</li>}
        </ul>
        {adding && (
          <fieldset className="q-panel">
            <legend>New Question</legend>
            <div className="row">
              <label>Category
                <select value={newQ.category} onChange={(e) => setNewQ({ ...newQ, category: e.target.value as Category })}>{categoryOptions}</select>
              </label>
              <label className="grow">Question<input value={newQ.text} onChange={(e) => setNewQ({ ...newQ, text: e.target.value })} /></label>
            </div>
            <ClassificationControls taxonomy={taxonomy} value={classification} onChange={setClassification} label="Tags"/>
            <div className="row">
              <button disabled={busy || newQ.text.trim().length < 2} onClick={addCustom}>Save</button>
              <button onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </fieldset>
        )}
        {errorAt("questions")}
        {(!adding || selected.length > 0) && (
          <div className="row q-foot">
            {!adding && <button className="link" onClick={() => setAdding(true)}><span aria-hidden="true">+ </span>Add a Question</button>}
            {selected.length > 0 && <button className="link" onClick={() => setSelected([])}>Clear Selection</button>}
          </div>
        )}
      </section>

      <label className="inline-field start-app">Application
        <select value={applicationId} disabled={busy} onChange={e => setApplicationId(e.target.value)}>
          <option value="">None</option>
          {apps.map(a => <option key={a.id} value={a.id} lang="ko">{a.company} · {a.position}</option>)}
        </select>
      </label>
      {previewError && <p className="err">{previewError}</p>}
      <div className="row start-actions">
        <button className="primary" disabled={busy || !selected.length} onClick={startFree}>Start Practice ({selected.length})</button>
        <button disabled={busy || mockCats.length === 0} onClick={startMock}>Mock Interview</button>
      </div>
      {errorAt("start")}

      <details className="card fold start-fold">
        <summary>More Options</summary>
        <fieldset>
          <legend>Mock Interview</legend>
          <div className="row">
            <label>Number of questions<input type="number" min={1} max={20} value={mock.count} onChange={(e) => setMock({ ...mock, count: +e.target.value })} /></label>
            <label>Prep time (sec)<input type="number" min={0} max={300} value={mock.prep_sec} onChange={(e) => setMock({ ...mock, prep_sec: +e.target.value })} /></label>
            <label>Answer time (sec)<input type="number" min={10} max={600} value={mock.answer_sec} onChange={(e) => setMock({ ...mock, answer_sec: +e.target.value })} /></label>
          </div>
          <fieldset>
            <legend>Categories</legend>
            <div className="row small">
              {CATEGORIES.map((c) => (
                <label key={c} className="check-label">
                  <input type="checkbox" checked={mockCats.includes(c)} onChange={() => setMockCats((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))} />
                  {label("category", c)}
                </label>
              ))}
            </div>
            {mockCats.length === 0 && <p className="err">Choose at least one category.</p>}
          </fieldset>
          <label>Job
            <select value={mock.job_category} onChange={(e) => setMock({ ...mock, job_category: e.target.value })}>
              <option value="">{label("job", "공통")}</option>
              {jobOptions}
            </select>
          </label>
        </fieldset>
        <label>Job posting (optional)
          <textarea value={jobDescription} maxLength={12000} onChange={(e) => setJobDescription(e.target.value)} placeholder="Paste the duties and requirements." style={{ minHeight: 80 }} />
        </label>
        <label>Essay version
          <select value={essayBasis} onChange={(e) => setEssayBasis(e.target.value as "submitted" | "latest")}>
            <option value="submitted">Submitted (latest if none)</option>
            <option value="latest">Latest</option>
          </select>
        </label>
        {preview.length > 0 && (
          <ul className="plain small" data-testid="practice-context-preview">
            {preview.map((e) => <li key={e.id}><span lang="ko">{e.question_text}</span> · v{e.version_no} · {e.label}</li>)}
          </ul>
        )}
        <label className="check-label"><input type="checkbox" checked={followups} onChange={(e) => setFollowups(e.target.checked)} />Offer follow-up questions</label>
        <fieldset>
          <legend>Filters</legend>
          <div className="row">
            <label>Job
              <select value={filter.job_category} onChange={(e) => setFilter({ ...filter, job_category: e.target.value })}>
                <option value="">All Jobs</option>
                {jobOptions}
              </select>
            </label>
            <label>Source
              <select value={filter.source} onChange={(e) => setFilter({ ...filter, source: e.target.value })}>
                <option value="">All Sources</option>
                {SOURCES.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
              </select>
            </label>
            {taxonomy?.enabled && (
              <label>Question type
                <select value={tagFilter.type} onChange={e=>setTagFilter({...tagFilter,type:e.target.value})}>
                  <option value="">All Types</option>
                  {taxonomy.question_types.map(t=><option key={t.key} value={t.key}>{label("questionType", t.key)}</option>)}
                </select>
              </label>
            )}
          </div>
          {taxonomy?.enabled && (
            <>
              <fieldset>
                <legend>Competencies</legend>
                <div className="row small">
                  {taxonomy.competencies.map(c=><label className="check-label" key={c.key}><input type="checkbox" checked={tagFilter.keys.includes(c.key)} onChange={()=>setTagFilter({...tagFilter,keys:tagFilter.keys.includes(c.key)?tagFilter.keys.filter(k=>k!==c.key):[...tagFilter.keys,c.key]})}/>{label("competency", c.key)}</label>)}
                </div>
              </fieldset>
              <label>Match
                <select value={tagFilter.match} onChange={e=>setTagFilter({...tagFilter,match:e.target.value as 'any'|'all'})}>
                  <option value="any">Any selected competency</option>
                  <option value="all">All selected competencies</option>
                </select>
              </label>
            </>
          )}
        </fieldset>
      </details>

      <details className="card fold start-fold">
        <summary>Generate Questions from an Essay</summary>
        {applicationId ? <p className="small muted">Uses the essays from the selected application.</p> : (
          <>
            <div className="row">
              <label className="grow">Company<input value={gen.company} onChange={(e) => setGen({ ...gen, company: e.target.value })} /></label>
              <label className="grow">Role<input value={gen.position} onChange={(e) => setGen({ ...gen, position: e.target.value })} /></label>
            </div>
            <label>Essay<textarea value={gen.essay_text} onChange={(e) => setGen({ ...gen, essay_text: e.target.value })} /></label>
          </>
        )}
        <div className="row bottom">
          <label>Number of questions<input type="number" min={1} max={10} value={gen.count} onChange={(e) => setGen({ ...gen, count: +e.target.value })} /></label>
          <button disabled={busy} onClick={generate}>Generate Questions</button>
        </div>
        {errorAt("generate")}
      </details>
    </div>
  );
}
