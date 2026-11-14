import type { ReactNode } from 'react';
import { label, langOf } from '../labels';
import type { PracticeSession } from '../types';
import { answerComments, answerCoaching, competencyCoverage, groundedOutline, integratedCoaching, localDeliveryFacts } from '../review/coaching';

const plural=(n:number,word:string)=>`${n} ${word}${n===1?'':'s'}`;
const BASIS:Record<string,string>={past_action:'Past Action',proposed_action:'Proposed Action',explanation:'Explanation'};

/** App sentences are English; the “quoted” words inside them come from answers and old records, usually Korean */
export function Quoted({text}:{text:string}) {
 return <>{text.split(/(“[^”]*”)/).map((part,i)=>i%2 ? <span key={i} lang={langOf(part)}>{part}</span> : part)}</>;
}

/** The session's coaching notes, built from stored checks and this tab's numbers (no new AI request). */
export default function IntegratedCoaching({result}:{result:ReturnType<typeof integratedCoaching>}) {
 return <div className="integrated-coaching"><h3>Coaching Notes</h3>{result.script.split('\n\n').map((p,i)=><p key={i}><Quoted text={p}/></p>)}{result.actions.length>0&&<><h4>Try Next Time</h4><ol>{result.actions.map((x,i)=><li key={i}><a href={`#answer-${x.answerId}`}>Q{x.order}</a> <span lang={langOf(x.text)}>{x.text}</span></li>)}</ol></>}</div>;
}
export function CompetencyPanel({s}:{s:PracticeSession}) {
 const {missing,untagged,extraObservations,rows}=competencyCoverage(s.answers);
 if(!rows.length&&!s.answers.some(a=>a.question_classification)) return null;
 return <div className="competency-review"><h3>Skills Practiced</h3>
  <p className="small muted">Question counts show what you practiced. A quote links part of an answer to a skill; it isn't a skill rating. A question with several skills counts for each one.</p>
  {missing>0&&<p className="small muted">{plural(missing,'answer')} started without tags, so {missing===1?"it isn't":"they aren't"} counted.</p>}
  {untagged>0&&<p className="small muted">{plural(untagged,'answer')} {untagged===1?'has':'have'} tags but no skills.</p>}
  {rows.map((r,i)=><div key={i} className="competency-row"><h4>{label('competency',r.key)}</h4><p>{plural(r.questionCount,'question')} · {plural(r.observedCount,'quote')}</p><p className="small muted">Assigned {r.questionCount} · Answered {r.answeredCount} · Transcribed {r.transcribedCount} · Analyzed {r.analyzedCount} · Quoted {r.observedCount} · Main {r.primaryCount} / Follow-up {r.followupCount}</p>{r.observations.length?<ul className="plain">{r.observations.map((o,j)=><li key={j}><a href={`#answer-${o.answerId}`}>Q{o.order}</a> <span className="chip">{BASIS[o.basis]??o.basis}</span><blockquote className="quote" lang="ko">“{o.quote}”</blockquote><p className="small" lang={langOf(o.reason)}>{o.reason}</p></li>)}</ul>:<p className="small muted">No quoted evidence yet. Tags alone don't count as evidence.</p>}</div>)}
  {extraObservations.length>0&&<details className="fold"><summary>Other Skills Seen</summary>{extraObservations.map((o,i)=><div key={i}><a href={`#answer-${o.answerId}`}>Q{o.order}</a> {label('competency',o.key)}<blockquote className="quote" lang="ko">“{o.quote}”</blockquote><p lang={langOf(o.reason)}>{o.reason}</p></div>)}</details>}
 </div>;
}
/** One answer's next step, then its checks (children), then coaching notes and an outline built from the transcript, folded. */
export function AnswerGuidance({a,sessionId,children}:{a:PracticeSession['answers'][number];sessionId:string;children?:ReactNode}) {
 const comments=answerComments(a); const outline=groundedOutline(a);
 const coaching=answerCoaching(a,localDeliveryFacts({id:sessionId,answers:[a]} as PracticeSession));
 return <>
  {coaching.priority&&<p className="answer-next" data-testid="answer-next"><b>Next:</b> <span lang={langOf(coaching.priority)}>{coaching.priority}</span></p>}
  {children}
  {(coaching.script||comments.length>0)&&<details className="fold"><summary>Coaching Notes</summary>{coaching.script&&<p><Quoted text={coaching.script}/></p>}{comments.map((c,i)=><div key={i} className="comment"><p className="small muted">{c.source} · {label('verdict',c.status)}</p><blockquote className="quote" lang="ko">“{c.quote}”</blockquote><p lang={langOf(c.text)}>{c.text}</p></div>)}</details>}
  {outline.length>0&&<details className="fold"><summary>Answer Outline</summary><p className="small muted">Built from your transcript. Fill the brackets with what really happened; don't add new experiences or results.</p><ol>{outline.map((line,i)=><li key={i} style={{whiteSpace:'pre-wrap'}}><Quoted text={line}/></li>)}</ol></details>}
 </>;
}
