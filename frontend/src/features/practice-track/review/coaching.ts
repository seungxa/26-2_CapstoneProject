import type { CoachingReport, PracticeAnswer, PracticeSession, TaxonomyEntry } from '../types';
import { getVoiceSegment, withVoiceTranscript } from '../delivery/voice';
import { label } from '../labels';
import { getVideoSegments } from '../video/metrics';
import { CRITERIA, sessionInsights } from './insights';

type Criterion = CoachingReport['criteria'][number];
export type GroundedComment = { type:'content'; key:Criterion['key']; item:string; status:Criterion['status']; source: string; quote: string; text: string; action?: string };
const excerpt=(text:string,max=140)=>text.length>max?`${text.slice(0,max)}…`:text;
const plural=(n:number,word:string)=>`${n} ${word}${n===1?'':'s'}`;
const textOf = (a: PracticeAnswer) => a.transcript?.trim() ?? '';
const currentReport = (a: PracticeAnswer) => a.coaching_report?.input_status === 'legacy_unverified' ? null : a.coaching_report;
/** Checks that quote this transcript word for word. The stored verdict and reason are kept apart for display */
export function answerComments(a: PracticeAnswer): GroundedComment[] {
  const text = textOf(a);
  if (!text) return [];
  return (currentReport(a)?.criteria ?? []).filter(c => c.answer_quote?.trim() && text.includes(c.answer_quote.trim())).map(c => {
    const item=label('criterion',c.key);
    return {type:"content" as const,key:c.key,item,status:c.status,source:`Answer check · ${item}`, quote:c.answer_quote.trim(), text:c.reason};
  });
}
export function competencyCoverage(answers: PracticeAnswer[]) {
  type Row = TaxonomyEntry & {questionCount:number;answeredCount:number;transcribedCount:number;analyzedCount:number;primaryCount:number;followupCount:number;observedCount:number;observations:{answerId:string;order:number;quote:string;reason:string;basis:string}[]};
  const rows = new Map<string,Row>(); let missing=0,untagged=0;
  const extraObservations:{key:string;answerId:string;order:number;quote:string;reason:string}[]=[];
  for (const a of answers) {
    const snapshot=a.question_classification;
    if (!snapshot) {missing++;continue;}
    if(!snapshot.competencies.length) untagged++;
    const evidence=currentReport(a)?.competency_evidence;
    if(evidence?.status==='analyzed') for(const o of evidence.observations) {
      if(!snapshot.competencies.some(c=>c.key===o.competency_key)&&o.quote.trim()&&textOf(a).includes(o.quote.trim())) extraObservations.push({key:o.competency_key,answerId:a.id,order:a.order_no,quote:o.quote,reason:o.reason});
    }
    for (const c of snapshot.competencies) {
      // Version and label are frozen per answer; never substitute live question tags.
      const id = `${snapshot.taxonomy_version}:${c.key}`;
      const row=rows.get(id) ?? {...c,questionCount:0,answeredCount:0,transcribedCount:0,analyzedCount:0,primaryCount:0,followupCount:0,observedCount:0,observations:[]}; row.questionCount++;
      if(a.recorded_at||textOf(a)) row.answeredCount++;
      if(textOf(a)) row.transcribedCount++;
      if(currentReport(a)?.competency_evidence?.status==='analyzed') row.analyzedCount++;
      if(snapshot.question_role==='followup') row.followupCount++; else row.primaryCount++;
      const evidence=currentReport(a)?.competency_evidence;
      const hit=evidence?.status==='analyzed' ? evidence.observations.find(o=>o.competency_key===c.key && o.quote.trim() && textOf(a).includes(o.quote.trim())) : undefined;
      if(hit) {row.observedCount++;row.observations.push({answerId:a.id,order:a.order_no,quote:hit.quote,reason:hit.reason,basis:hit.basis});}
      rows.set(id,row);
    }
  }
  return {missing,untagged,extraObservations,rows:[...rows.values()]};
}
/** An outline to fill in from the user's own transcript. Brackets are blanks; nothing new is invented */
export function groundedOutline(a: PracticeAnswer): string[] {
  const text=textOf(a); if(!text) return [];
  const prompts:Record<string,string[]> = {
    self_description:['Main point: [the strength or trait you actually want to show]', 'Evidence: [a real example that shows it, and its limits]', 'Link to the question: [how it answers what the question asks about you]'],
    motivation:['Why you applied: [your real reason and goal]', 'What it is based on: [what you learned about the company or role, and your own experience]', 'Connection: [what you prepared for the goal and what you still need to check]'],
    behavioral:['Situation and task: [what really happened and what had to be done]', 'Action and judgment: [your own part in the team and why you chose it]', 'Result and lesson: [only results you actually confirmed]'],
    situational:['Assumptions: [the conditions given and what you would check first]', 'How you would decide: [your choice, the alternatives, and their trade-offs]', 'Steps: [what you would do and how you would check the result, kept apart from real experience]'],
    project_deep_dive:['Project context: [the real goal and constraints]', 'Choices and role: [your scope, why you chose it, and the alternatives you weighed]', 'Checks and limits: [the real result, how you verified it, and what remains]'],
    knowledge:['Concept and answer: [the principle or key answer you want to explain]', 'Reasoning: [why it holds and when it applies]', 'Checks and limits: [an example you can verify, and what you don\'t know]'],
  };
  const outline=prompts[a.question_classification?.question_type ?? ''] ?? ['What the question asks: [the main point you want to make]', 'Support: [material you can check and your reasoning]', 'To check: [what is still missing for this question, and what you don\'t know]'];
  return [outline[0], `From your answer: “${text}”`, ...outline.slice(1)];
}
export type DeliveryFact = {answerId:string;order:number;kind:'voice'|'camera';source:string;text:string;action?:string};
/** Voice and camera numbers measured in this tab, as short sentences with one optional action each. */
export function localDeliveryFacts(s:PracticeSession):DeliveryFact[] {
 return s.answers.flatMap(a=>{
  if(!a.recorded_at) return [];
  const facts:DeliveryFact[]=[];
  const voice=getVoiceSegment(s.id,a.id,a.recorded_at,a.transcript??'');
  if(voice) {
   const v=withVoiceTranscript(voice,a.transcript??'');
   if(v.quality==='usable'&&v.activeCandidateSec!=null) facts.push({answerId:a.id,order:a.order_no,kind:'voice',source:'Voice',text:`Speech on ${v.activeCandidateSec.toFixed(1)}s of ${v.totalSec.toFixed(1)}s, ${Math.round(v.coverage*100)}% analyzed.${v.longestPauseSec!=null?` Longest pause ${v.longestPauseSec.toFixed(1)}s.`:''}`,action:v.longPauseCount&&v.longPauseCount>0?'Where you paused long, split the transcript into shorter parts and record again.':undefined});
  }
  const v=getVideoSegments(s.id,a.id,a.recorded_at);
  if(v&&v.analyzedMs>0) facts.push({answerId:a.id,order:a.order_no,kind:'camera',source:'Camera',text:`Face partly out of view for ${(v.edgeMs/1000).toFixed(1)}s of ${Math.round(v.analyzedMs/1000)}s analyzed.`,action:v.edgeMs>=1000?'Adjust the camera so your forehead and chin are both in the preview, then record again.':undefined});
  return facts;
 });
}
/** Local composition only: existing core coaching plus quoted facts, never a new AI request. */
export function integratedCoaching(s: PracticeSession, delivery: DeliveryFact[] = []) {
  const answered=s.answers.filter(a=>textOf(a));
  const comments=s.answers.flatMap(a=>answerComments(a).map(c=>({...c,a})));
  const tieOrder:Record<string,number>={"coaching-relevance":0,"coaching-specificity":1,"coaching-consistency":2};
  const points=[...sessionInsights(s).points].sort((a,b)=> Number(b.source==='coaching')-Number(a.source==='coaching') || new Set(b.answers.map(x=>x.id)).size-new Set(a.answers.map(x=>x.id)).size || (tieOrder[a.key]??3)-(tieOrder[b.key]??3));
  const actions:{answerId:string;order:number;text:string}[]=[];
  for(const p of points) {
    const ref=p.answers[0]; if(ref && !actions.some(x=>x.text===p.action)) actions.push({answerId:ref.id,order:ref.order,text:p.action});
    if(actions.length===2) break;
  }
  const parts=[`This review uses ${plural(answered.length,'transcript')} from ${plural(s.answers.length,'answer')}.`];
  // An earlier debrief's lesson is said once, in the Summary line, so the notes don't repeat it
  const primary=points.find(p=>p.source==='coaching');
  const primaryKey=CRITERIA.find(c=>`coaching-${c.key}`===primary?.key);
  if(primary&&primaryKey) parts.push(`${primaryKey.label} needs work in ${plural(new Set(primary.answers.map(x=>x.id)).size,'answer')}, so start there.`);
  const positive=comments.find(c=>c.status==='충분');
  if(positive) parts.push(`Keep this from Q${positive.a.order_no}: “${excerpt(positive.quote,90)}” It meets the ${positive.item} check: “${excerpt(positive.text,120)}”`);
  const improvement=primaryKey ? comments.find(c=>c.a.id===primary?.answers[0]?.id && c.status==='보완' && c.key===primaryKey.key) : comments.find(c=>c.status==='보완');
  if(improvement) parts.push(`For example, in Q${improvement.a.order_no} you said “${excerpt(improvement.quote,90)}” The check noted: “${excerpt(improvement.text,140)}” Start from this sentence and add what's missing from your real experience.`);
  for(const fact of delivery.slice(0,2)) {
    parts.push(`${fact.source}, Q${fact.order}: ${fact.text} This is about delivery, separate from the content checks.`);
    if(fact.action && actions.length<2 && !actions.some(x=>x.text===fact.action)) actions.push({answerId:fact.answerId,order:fact.order,text:fact.action});
  }
  if(!comments.length) parts.push(answered.length ? 'There are no quoted checks yet. Read the transcripts below and use Check Answer first.' : 'There are no answers yet. Save an answer and come back.');
  if(!actions.length && answered.length) actions.push({answerId:answered[0].id,order:answered[0].order_no,text:'Read the transcript, then use Check Answer to see what to work on.'});
  return {script:excerpt(parts.join('\n\n'),1000),actions:actions.slice(0,2),comments};
}

/** One answer's content coaching. Voice and camera numbers and their actions are shown once, in the answer's Delivery section */
export function answerCoaching(a:PracticeAnswer) {
 const comments=answerComments(a);
 const improvement=comments.find(c=>c.status==='보완');
 const positive=comments.find(c=>c.status==='충분');
 const parts:string[]=[];
 if(positive) parts.push(`Keep “${excerpt(positive.quote,100)}”. It meets the ${positive.item} check.`);
 if(improvement) parts.push(`Start with ${improvement.item}. For “${excerpt(improvement.quote,100)}”, the check noted: “${excerpt(improvement.text,160)}”`);
 const priority=currentReport(a)?.next_action?.trim()||null;
 return {script:parts.join(' '),priority,comments};
}
