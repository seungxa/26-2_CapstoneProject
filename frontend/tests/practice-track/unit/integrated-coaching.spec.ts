import { expect, test } from '@playwright/test';
import { competencyCoverage, groundedOutline, integratedCoaching, answerComments, answerCoaching, localDeliveryFacts } from '../../../src/features/practice-track/review/coaching';
import * as voice from '../../../src/features/practice-track/delivery/voice';
import * as metrics from '../../../src/features/practice-track/video/metrics';
import type { PracticeAnswer, PracticeSession } from '../../../src/features/practice-track/types';
const answer = (over: Partial<PracticeAnswer> = {}) => ({ id:'a', order_no:1, transcript:'제가 일정 관리를 맡고 매일 진행 상황을 확인했습니다.', recorded_at:null, question:{text:'협업 경험',category:'인성',competency_keys:['teamwork']}, coaching_report:null, question_classification:null, ...over } as PracticeAnswer);
const session = (answers: PracticeAnswer[]) => ({ id:'s',answers,mode:'free',answer_sec:90,debrief:null,redrill:[] } as unknown as PracticeSession);
const snapshot = {schema_version:1 as const,taxonomy_version:'v1',question_type:'experience',question_type_label:'경험',question_type_definition:'실제 경험',competencies:[{key:'teamwork',label:'협업',definition:'함께 일하기'}],tagging_source:'manual',question_role:'primary' as const,captured_at:'now'};
test('historical debrief without a verified input identity is preserved separately, not narrated as a current finding', () => {
 const s={...session([answer()]),debrief_status:'done',debrief:{lesson:'과거 전용 교훈입니다',input_status:'legacy_unverified'}} as PracticeSession;
 expect(integratedCoaching(s).script).not.toContain('과거 전용 교훈입니다');
});
test('coverage counts frozen question scope separately from quoted observations and preserves legacy null', () => {
 const a=answer({question_classification:snapshot});
 expect(competencyCoverage([a,answer()])).toMatchObject({missing:1,untagged:0,extraObservations:[],rows:[{key:'teamwork',label:'협업',questionCount:1,answeredCount:1,transcribedCount:1,analyzedCount:0,primaryCount:1,followupCount:0,observedCount:0}]});
 expect(competencyCoverage([answer()]).rows).toEqual([]);
});
test('only actual transcript quotes count as observed evidence; changed transcripts reject old quotes', () => {
 const evidence={status:'analyzed',method:'ai',observations:[{competency_key:'teamwork',basis:'past_action',quote:'매일 진행 상황을 확인했습니다',reason:'진행 공유'}]};
 const a=answer({question_classification:snapshot,coaching_report:{competency_evidence:evidence,criteria:[]} as never});
 expect(competencyCoverage([a]).rows[0].observedCount).toBe(1);
 expect(competencyCoverage([{...a,transcript:'새 답변'}]).rows[0].observedCount).toBe(0);
});
test('coaching has no invented praise or measurements with absent evidence; outline uses verbatim words and placeholders', () => {
 const a=answer(); const result=integratedCoaching(session([a]));
 expect(result.script).toContain('1 transcript from 1 answer');
 expect(result.script).not.toMatch(/excellent|confiden|per minute|gaze|eye contact|success/i);
 expect(result.script).not.toMatch(/[가-힣]/); // app sentences are English; only quoted answers are Korean
 expect(result.actions.length).toBeLessThanOrEqual(3);
 expect(groundedOutline(a).join(' ')).toContain(a.transcript!);
 expect(groundedOutline(a).join(' ')).toContain('[the'); expect(answerComments(a).length).toBe(0);
 expect(groundedOutline(a).join(' ').replace(a.transcript!,'')).not.toMatch(/[가-힣]/);
});
test('prioritises grounded core coaching over generic preparation and refers to answer source', () => {
 const a=answer({coaching_report:{criteria:[{key:'specificity',label:'구체성',status:'보완',reason:'결과 설명이 필요해요',answer_quote:'제가 일정 관리를 맡고',source_quote:'',source_version_id:null}],next_action:'실제 결과를 한 문장으로 덧붙이세요'} as never});
 const r=integratedCoaching(session([a])); expect(r.script).toContain('Q1'); expect(r.script).toContain('제가 일정 관리를 맡고');
 expect(r.actions[0].text).toContain('실제 결과'); expect(answerComments(a)[0].source).toBe('Answer check · Specificity');
 expect(answerComments(a)[0]).toMatchObject({key:'specificity',status:'보완',text:'결과 설명이 필요해요'});
});
test('coaching groups a shared content pattern rather than concatenating each criterion', () => {
 const core={criteria:[{key:'specificity',label:'구체성',status:'보완',reason:'결과가 빠졌어요',answer_quote:'제가 일정 관리를 맡고'}],next_action:'실제로 확인한 결과를 추가하기'};
 const a=answer({coaching_report:core as never});
 const b={...a,id:'b',order_no:2};
 const script=integratedCoaching(session([a,b])).script;
 expect(script).toContain('Specificity needs work in 2 answers');
 expect(script.match(/결과가 빠졌어요/g)?.length).toBe(1);
});

test('coverage separates untagged snapshots and followups; narrative stays bounded', () => {
 const a=answer({question_classification:{...snapshot,question_role:'followup'}});
 const empty=answer({question_classification:{...snapshot,competencies:[]}});
 expect(competencyCoverage([a,empty])).toMatchObject({missing:0,untagged:1,rows:[{primaryCount:0,followupCount:1}]});
 const report={criteria:[{key:'specificity',label:'구체성',status:'보완',reason:'근거'.repeat(1000),answer_quote:'제가 일정 관리를 맡고'}],next_action:'행동'.repeat(1000)};
 expect(integratedCoaching(session([answer({coaching_report:report as never})])).script.length).toBeLessThanOrEqual(1001);
});

test('per-answer coaching joins one priority with measured delivery and no invented strength', () => {
 const result=answerCoaching(answer(),[{answerId:'a',order:1,kind:'camera',source:'Camera',text:'Face partly out of view for 2.0s of 5s analyzed.',action:'Check the camera position'}]);
 expect(result.script).toContain('Face partly out of view for 2.0s of 5s analyzed.');
 expect(result.priority).toBe('Check the camera position');
 expect(result.script).not.toMatch(/great|well done|excellent|meets/i);
});

test('answer action belongs once to the whole answer, not to every weak criterion', () => {
 const a=answer({coaching_report:{criteria:['specificity','relevance'].map((key)=>({key,label:key,status:'보완',reason:'추가 설명 필요',answer_quote:'제가 일정 관리를 맡고'})),next_action:'하나의 다음 행동'} as never});
 const result=answerCoaching(a);
 expect(result.comments.every(c=>!c.action)).toBe(true);
 expect(result.priority).toBe('하나의 다음 행동');
});

test('session themes use distinct affected answers then relevance before specificity ties', () => {
 const weak=(key:string)=>({key,label:key==='relevance'?'질문 적합성':'구체성',status:'보완',reason:'확인할 근거',answer_quote:'제가 일정 관리를 맡고'});
 const a=answer({coaching_report:{criteria:[weak('specificity'),weak('relevance')],next_action:'한 행동'} as never});
 const b=answer({id:'b',order_no:2,coaching_report:{criteria:[weak('relevance')],next_action:'다른 행동'} as never});
 const r=integratedCoaching(session([a,b]));
 expect(r.script).toContain('Relevance needs work in 2 answers');
 expect(r.actions.length).toBeLessThanOrEqual(2);
 const tied=integratedCoaching(session([a]));
 expect(tied.script).toContain('Relevance needs work in 1 answer');
});

test('unverified historical coaching is excluded from current comments, priorities, and observations', () => {
 const a=answer({question_classification:snapshot,coaching_report:{input_status:'legacy_unverified',criteria:[{key:'specificity',label:'구체성',status:'보완',reason:'과거 조언',answer_quote:'제가 일정 관리를 맡고'}],next_action:'과거 행동',competency_evidence:{status:'analyzed',observations:[{competency_key:'teamwork',basis:'past_action',quote:'매일 진행 상황을 확인했습니다',reason:'과거 해석'}]}} as never});
 expect(answerComments(a)).toEqual([]);
 expect(integratedCoaching(session([a])).script).not.toContain('과거 조언');
 expect(competencyCoverage([a]).rows[0].observedCount).toBe(0);
});

test('outlines follow each question type and keep unknown questions neutral', () => {
 const expected:Record<string,string>={behavioral:'Situation and task',situational:'Assumptions',knowledge:'Concept',motivation:'Why you applied',project_deep_dive:'Choices and role',self_description:'Main point'};
 for(const [type,word] of Object.entries(expected)) {
  const lines=groundedOutline(answer({question_classification:{...snapshot,question_type:type}}));
  expect(lines.join(' ')).toContain(word);
  expect(lines.join(' ')).toContain(answer().transcript!);
 }
 const unknown=groundedOutline(answer()).join(' ');
 expect(unknown).not.toContain('Result and lesson');
 expect(unknown).toContain('What the question asks');
});

test('current report keeps its single next action even when every criterion defers without a quote', () => {
 const a=answer({coaching_report:{input_status:'current',criteria:[{key:'relevance',label:'질문 적합성',status:'판단유보',reason:'근거가 부족해요',answer_quote:''}],next_action:'질문이 요구하는 답을 한 문장으로 정리하기'} as never});
 expect(answerCoaching(a).priority).toBe('질문이 요구하는 답을 한 문장으로 정리하기');
 expect(answerCoaching(a).comments).toEqual([]);
});

test('delivery facts from this tab are English with a kind for each source', () => {
 const a=answer({id:'df',recorded_at:'r1'});
 const s={...session([a]),id:'df-session'} as PracticeSession;
 expect(localDeliveryFacts(s)).toEqual([]); // nothing measured in this tab
 const energy=[...Array(20).fill(0.003),...Array(25).fill(0.08),...Array(25).fill(0.003),...Array(30).fill(0.09)].map((rms,i)=>({t:i/10,rms}));
 voice.saveVoiceSegment('df-session','df',voice.summarizeVoice(energy,10,a.transcript!),'r1',a.transcript);
 metrics.saveVideoSegment('df-session','df',metrics.summarizeSegment(Array.from({length:12},(_,i)=>({t:i*250,state:'edge' as const})),{start:0,end:3000}),'r1');
 try {
  const facts=localDeliveryFacts(s);
  expect(facts.map(f=>[f.kind,f.source])).toEqual([['voice','Voice'],['camera','Camera']]);
  expect(facts.every(f=>f.action)).toBe(true); // a long pause and >=1s partly out of view each suggest one action
  for(const f of facts) expect(`${f.text} ${f.action}`).not.toMatch(/[가-힣]/);
  expect(facts[1].text).toBe('Face partly out of view for 3.0s of 3s analyzed.');
 } finally { voice.clearSessionVoice('df-session'); metrics.clearSessionVideo('df-session'); }
});
