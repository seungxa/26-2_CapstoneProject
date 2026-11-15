import {test,expect,type APIRequestContext,type Locator,type Page} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {API,databasePath} from './env';

async function reviewedSession(request:APIRequestContext) {
 const questions=[];
 for(let i=0;i<2;i++) questions.push(await (await request.post(`${API}/practice/questions`,{data:{category:'직무',text:`캐시 검토 질문 ${i} ${Date.now()}-${Math.random()}`}})).json());
 const s=await (await request.post(`${API}/practice/sessions`,{data:{mode:'free',question_ids:questions.map(q=>q.id)}})).json();
 for(const a of s.answers) {
  await request.patch(`${API}/practice/answers/${a.id}`,{data:{transcript:`합성 답변 ${a.order_no}에서 로그를 분류했습니다.`,self_rating:1}});
  await request.post(`${API}/practice/answers/${a.id}/coach`);
 }
 const saved=await (await request.get(`${API}/practice/sessions/${s.id}`)).json();
 return {...saved,debrief_status:'done',debrief:{lesson:'변경 전 세션의 오래된 해석',next_action:'변경 전 다음 행동',moments:[]}};
}

async function routeSession(page:Page,s:Awaited<ReturnType<typeof reviewedSession>>,options:{fail?:boolean}={}) {
 await page.route(`**/practice/sessions/${s.id}`,async route=>{
  if(route.request().resourceType()==='document') return route.continue();
  if(options.fail) return route.fulfill({status:503,json:{detail:'합성 세션 새로고침 실패'}});
  return route.fulfill({json:s});
 });
}

/** Answer cards start folded: open one by its summary line */
async function open(card:Locator) {
 await card.locator(':scope > summary').click();
 await expect(card).toHaveAttribute('open','');
}
/** The Summary card keeps charts, coaching notes and the re-drill list under one Details fold */
const openSummaryDetails=(page:Page)=>page.locator('.review-summary .summary-details > summary').click();

test('Track source omits hidden direct inputs from question generation requests',async({page,request})=>{
 const app=await (await request.post(`${API}/track/applications`,{data:{company:'선택한 Track 회사',position:'선택한 직무'}})).json();
 await page.goto('/practice');
 await page.getByText('Generate Questions from an Essay',{exact:true}).click();
 await page.getByRole('textbox',{name:'Company',exact:true}).fill('숨겨질 직접 회사');
 await page.getByRole('textbox',{name:'Role',exact:true}).fill('숨겨질 직접 직무');
 await page.getByRole('textbox',{name:'Essay',exact:true}).fill('숨겨질 직접 자소서');
 await page.getByRole('combobox',{name:'Application',exact:true}).selectOption(app.id);
 await expect(page.getByRole('textbox',{name:'Essay',exact:true})).toHaveCount(0);
 const outgoing=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/practice/questions/generate'));
 await page.getByRole('button',{name:'Generate Questions',exact:true}).click();
 const body=(await outgoing).postDataJSON();
 expect(body.application_id).toBe(app.id);
 expect(body).not.toHaveProperty('company');
 expect(body).not.toHaveProperty('position');
 expect(body).not.toHaveProperty('essay_text');
});

test('draft pauses the entire integrated narrative and actions, and revert restores them',async({page,request})=>{
 const s=await reviewedSession(request); await routeSession(page,s);
 await page.goto(`/practice/sessions/${s.id}`);
 await openSummaryDetails(page);
 const integrated=page.locator('.integrated-coaching');
 await expect(integrated).toContainText('2 transcripts from 2 answers');
 await expect(page.getByTestId('summary-next')).toBeVisible();
 const last=page.locator(`#answer-${s.answers[1].id}`);
 await open(last);
 await last.getByLabel('Transcript',{exact:true}).fill('저장하지 않은 두 번째 설명');
 await expect(integrated).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Try Next Time'})).toHaveCount(0);
 await expect(page.getByTestId('summary-next')).toHaveCount(0);
 await expect(page.getByTestId('integrated-content-paused')).toBeVisible();
 await last.getByLabel('Transcript',{exact:true}).fill(s.answers[1].transcript);
 await expect(integrated).toContainText('2 transcripts from 2 answers');
 await expect(page.getByTestId('integrated-content-paused')).toHaveCount(0);
});

test('a verified debrief lesson appears once on the page, in the Summary line',async({page,request})=>{
 const s=await reviewedSession(request); await routeSession(page,s);
 await page.goto(`/practice/sessions/${s.id}`);
 await expect(page.getByTestId('summary-lesson')).toContainText('변경 전 세션의 오래된 해석');
 await openSummaryDetails(page);
 await expect(page.locator('.integrated-coaching')).toBeVisible();
 // Folded text counts too: the same guidance is said in one place only
 const text=(await page.locator('.practice-track').textContent())??'';
 expect(text.split('변경 전 세션의 오래된 해석').length-1).toBe(1);
});

test('successful transcript PATCH cannot restore old dependent guidance when session refresh fails',async({page,request})=>{
 const s=await reviewedSession(request); const options={fail:false}; await routeSession(page,s,options);
 await page.goto(`/practice/sessions/${s.id}`);
 const first=page.locator(`#answer-${s.answers[0].id}`); const later=page.locator(`#answer-${s.answers[1].id}`);
 await open(first); await open(later);
 await expect(later.locator('.coaching-panel')).toBeVisible();
 await expect(page.getByTestId('summary-lesson')).toContainText('변경 전 세션의 오래된 해석');
 await first.getByLabel('Transcript',{exact:true}).fill('저장한 새로운 첫 번째 설명');
 options.fail=true;
 await first.getByRole('button',{name:'Save',exact:true}).click();
 await expect(first.getByRole('button',{name:'Save',exact:true})).toBeDisabled();
 await expect(later.locator('.coaching-panel')).toHaveCount(0);
 await expect(page.locator('.review-summary')).not.toContainText('변경 전 세션의 오래된 해석');
 await expect(page.locator('.weak-list')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Practice Weak Answers Again',exact:true})).toBeDisabled();
 await expect(page.getByTestId('review-refresh-error')).toContainText('합성 세션 새로고침 실패');
 await expect(page.getByTestId('integrated-content-paused')).toBeVisible();
 // An explicit successful authoritative retry releases the pause; no model request.
 const fresh=await (await request.get(`${API}/practice/sessions/${s.id}`)).json();
 Object.assign(s,fresh); options.fail=false;
 await page.getByRole('button',{name:'Reload Review',exact:true}).click();
 await expect(page.getByTestId('review-refresh-error')).toHaveCount(0);
 await expect(page.getByTestId('integrated-content-paused')).toHaveCount(0);
 await expect(later.locator('.coaching-panel')).toHaveCount(0);
});

test('notes-only save with failed refresh retains answer coaching and pauses the invalidated session summary',async({page,request})=>{
 const s=await reviewedSession(request); const options={fail:false}; await routeSession(page,s,options);
 await page.goto(`/practice/sessions/${s.id}`);
 const first=page.locator(`#answer-${s.answers[0].id}`);
 await open(first);
 await first.getByLabel('Note',{exact:true}).fill('저장한 새 회고 메모');
 options.fail=true;
 await first.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.getByTestId('review-refresh-error')).toBeVisible();
 await expect(first.locator('.coaching-panel')).toBeVisible();
 await expect(page.locator('.review-summary')).not.toContainText('변경 전 세션의 오래된 해석');
 await expect(page.getByTestId('integrated-content-paused')).toBeVisible();
});

test('legacy criterion reason is retained in history but absent from current status grid tooltips',async({page,request})=>{
 const s=await reviewedSession(request);
 s.answers[0].coaching_report={...s.answers[0].coaching_report,input_status:'legacy_unverified',criteria:s.answers[0].coaching_report.criteria.map((c:Record<string,unknown>)=>({...c,reason:'이전 코칭 전용 이유'}))};
 await routeSession(page,s); await page.goto(`/practice/sessions/${s.id}`);
 await openSummaryDetails(page);
 const grid=page.getByRole('table',{name:'Checks for each answer'});
 const first=grid.getByRole('row').filter({hasText:'Q1'});
 await expect(first).toContainText('Not Checked');
 expect(await first.locator('[title]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('title')))).not.toContain('이전 코칭 전용 이유');
 await expect(page.locator(`#answer-${s.answers[0].id} .coaching-panel`)).toContainText('이전 코칭 전용 이유');
 await expect(page.locator(`#answer-${s.answers[0].id} > summary`)).toContainText('Earlier Check');
});

test('a delayed authoritative GET keeps dependent coaching paused immediately after PATCH succeeds',async({page,request})=>{
 const s=await reviewedSession(request); let hold=false;
 let release=()=>{}; const barrier=new Promise<void>(resolve=>{release=resolve;});
 let markEntered=()=>{}; const entered=new Promise<void>(resolve=>{markEntered=resolve;});
 await page.route(`**/practice/sessions/${s.id}`,async route=>{
  if(route.request().resourceType()==='document') return route.continue();
  if(hold) {markEntered(); await barrier; return route.fulfill({json:await (await request.get(`${API}/practice/sessions/${s.id}`)).json()});}
  return route.fulfill({json:s});
 });
 await page.goto(`/practice/sessions/${s.id}`);
 const first=page.locator(`#answer-${s.answers[0].id}`); const later=page.locator(`#answer-${s.answers[1].id}`);
 await open(first); await open(later);
 await first.getByLabel('Transcript',{exact:true}).fill('저장된 새로운 설명'); hold=true;
 try {
  await first.getByRole('button',{name:'Save',exact:true}).click(); await entered;
  await expect(later.locator('.coaching-panel')).toHaveCount(0);
  await expect(page.getByTestId('integrated-content-paused')).toBeVisible();
 } finally {release();}
 await expect(page.getByTestId('integrated-content-paused')).toHaveCount(0);
});

// Records made before OpenAI was removed: an AI coaching report, a session debrief summary, ai_feedback and Korean
// reasons. The API can no longer create them, so they go straight into this run's SQLite file.
const PLANT=`
import json, sqlite3, sys
db, session_id, coached_id, feedback_id, report, feedback, debrief = sys.argv[1:8]
con = sqlite3.connect(db)
stored = json.loads(con.execute("select report from answer_coaching where answer_id = ?", (coached_id,)).fetchone()[0])
stamps = {k: stored[k] for k in ("input_status", "input_sha256", "transcript_sha256", "question_classification_sha256", "rubric_version") if k in stored}
con.execute("update answer_coaching set report = ? where answer_id = ?", (json.dumps({**json.loads(report), **stamps}, ensure_ascii=False), coached_id))
con.execute("update practice_answers set ai_feedback = ? where id = ?", (feedback, feedback_id))
con.execute("update practice_sessions set debrief = ?, debrief_status = 'done' where id = ?", (debrief, session_id))
con.commit()
`;
const LEGACY_REASON='예전 AI가 남긴 구체성 이유: 결과 수치가 빠졌어요.';

test('legacy AI coaching and debrief still render',async({page,request})=>{
 const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
 const questions=[];
 for(let i=0;i<2;i++) questions.push(await (await request.post(`${API}/practice/questions`,{data:{category:'직무',text:`예전 기록 질문 ${i} ${Date.now()}-${Math.random()}`}})).json());
 const s=await (await request.post(`${API}/practice/sessions`,{data:{mode:'free',question_ids:questions.map(q=>q.id)}})).json();
 const [a1,a2]=[...s.answers].sort((x:{order_no:number},y:{order_no:number})=>x.order_no-y.order_no);
 const said='제가 장애 로그를 분류하고 원인을 찾았습니다.';
 await request.patch(`${API}/practice/answers/${a1.id}`,{data:{transcript:said}});
 await request.patch(`${API}/practice/answers/${a2.id}`,{data:{transcript:'두 번째 답변은 글로 남겼습니다.',self_rating:2}});
 expect((await request.post(`${API}/practice/answers/${a1.id}/coach`)).ok()).toBe(true);
 const criterion=(key:string,label:string,status:string,reason:string)=>({key,label,status,reason,answer_quote:said,source_quote:'',source_version_id:null});
 const report={method:'ai',summary:'예전 AI 코칭이 남긴 요약입니다.',next_action:'결과를 확인한 방법을 한 문장으로 덧붙이세요.',
  criteria:[criterion('specificity','구체성','보완',LEGACY_REASON),criterion('relevance','질문 적합성','충분','질문에 바로 답했어요.'),criterion('consistency','제출본 연결','판단유보','연결된 자소서가 없어요.')],
  followup:{text:'원인을 어떻게 확인하셨나요?',focus:'specificity',reason:'확인 방법',answer_quote:said,source_quote:'',source_version_id:null}};
 const debrief={lesson:'예전 AI 디브리프의 핵심 교훈입니다.',next_action:'예전 디브리프의 다음 행동입니다.',
  moments:[{answer_id:a1.id,order_no:1,quote:'장애 로그를 분류하고',why:'예전 AI가 고른 이유입니다.'}],generated_at:'2026-10-20T00:00:00Z',model:'gpt-legacy'};
 execFileSync('python',['-I','-c',PLANT,databasePath(),s.id,a1.id,a2.id,JSON.stringify(report),'예전 AI 피드백 원문입니다.',JSON.stringify(debrief)],{stdio:'pipe'});

 await page.goto(`/practice/sessions/${s.id}`);
 // One read-only line in the Summary carries the earlier lesson
 const lesson=page.getByTestId('summary-lesson');
 await expect(lesson).toContainText('Earlier AI review: “예전 AI 디브리프의 핵심 교훈입니다.”');
 await expect(lesson.locator('[lang="ko"]')).toHaveText('“예전 AI 디브리프의 핵심 교훈입니다.”');
 const first=page.locator(`#answer-${a1.id}`);
 await expect(first.locator(':scope > summary')).toContainText('Needs Work');
 await open(first);
 const panel=first.locator('.coaching-panel');
 await expect(panel).toContainText('Earlier AI Check');
 // Verdicts and criteria use the English names; the stored reason is shown word for word
 await expect(panel.locator('.criterion > summary')).toHaveText(['Specificity Needs Work','Relevance Meets','Matches Your Essay Not Judged']);
 const reason=panel.getByText(LEGACY_REASON,{exact:true});
 await expect(reason).toBeVisible();
 await expect(reason).toHaveAttribute('lang','ko');
 await expect(panel.getByText('예전 AI 코칭이 남긴 요약입니다.',{exact:true})).toBeVisible();
 await expect(first.getByTestId('answer-next')).toContainText('결과를 확인한 방법을 한 문장으로 덧붙이세요.');
 const second=page.locator(`#answer-${a2.id}`);
 await open(second);
 await expect(second.getByText('Earlier AI Feedback',{exact:true})).toBeVisible();
 await expect(second.getByText('예전 AI 피드백 원문입니다.',{exact:true})).toBeVisible();
 await openSummaryDetails(page);
 // Re-drill reasons stay "AI · 구체성 보완" / "자기평가 2점" on the server and show in English
 const weak=page.locator('.weak-list');
 await expect(weak.locator('.chip')).toHaveText(['AI · Specificity: Needs Work','Self-rating 2']);
 const earlier=page.locator('.earlier-review');
 await expect(earlier).toContainText('예전 디브리프의 다음 행동입니다.');
 await expect(earlier.getByText('“장애 로그를 분류하고”',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Practice Weak Answers Again',exact:true})).toBeEnabled();
 expect(errors).toEqual([]);
});

// Sessions from before OpenAI was removed can carry debrief_status 'failed': the AI summary failed while the answer
// checks were kept. New code never writes it, so it goes straight into this run's SQLite file.
const FAILED_SUMMARY=`
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
con.execute("update practice_sessions set debrief_status = 'failed' where id = ?", (sys.argv[2],))
con.commit()
`;
const NOT_EVERY="Couldn't check every answer.";

test('a legacy failed summary shows an error only while a transcribed answer has no checks',async({page,request})=>{
 const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
 const legacy=async(coached:number)=>{
  const questions=[];
  for(let i=0;i<2;i++) questions.push(await (await request.post(`${API}/practice/questions`,{data:{category:'직무',text:`예전 요약 실패 ${i} ${Date.now()}-${Math.random()}`}})).json());
  const s=await (await request.post(`${API}/practice/sessions`,{data:{mode:'free',question_ids:questions.map(q=>q.id)}})).json();
  for(const a of [...s.answers].sort((x:{order_no:number},y:{order_no:number})=>x.order_no-y.order_no)) {
   await request.patch(`${API}/practice/answers/${a.id}`,{data:{transcript:`예전 답변 ${a.order_no}에서 원인을 찾았습니다.`}});
   if(a.order_no<=coached) expect((await request.post(`${API}/practice/answers/${a.id}/coach`)).ok()).toBe(true);
  }
  execFileSync('python',['-I','-c',FAILED_SUMMARY,databasePath(),s.id],{stdio:'pipe'});
  return s;
 };
 // Every answer kept its checks: no red line
 const checked=await legacy(2);
 await page.goto(`/practice/sessions/${checked.id}`);
 await expect(page.getByRole('heading',{name:'Summary',exact:true})).toBeVisible();
 await expect(page.locator(`#answer-${checked.answers[0].id} > summary`)).not.toContainText('Not Checked');
 await expect(page.locator('.review-summary')).not.toContainText(NOT_EVERY);
 // One answer has a transcript but no checks: the line says so
 const partial=await legacy(1);
 await page.goto(`/practice/sessions/${partial.id}`);
 await expect(page.locator('.review-summary .err')).toHaveText(`${NOT_EVERY} Use Check Answer on the answers without checks.`);
 expect(errors).toEqual([]);
});
