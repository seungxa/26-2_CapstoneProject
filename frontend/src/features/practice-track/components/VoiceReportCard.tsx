import { useState } from 'react';
import { createArtifact, downloadArtifacts, EXPORT_NOTICE_EN, voiceMetrics } from '../validation/artifact';
import type { PracticeAnswer } from '../types';
import { clearVoiceSegment, getVoiceRunId, getVoiceSegment, withVoiceTranscript, type DeliverySummary } from '../delivery/voice';
import { CAMERA_DEBUG } from '../video/debug';

const REASON:Record<string,string>={sampling_gap:"gaps between samples",invalid_timestamp:"sample times couldn't be read",invalid_duration:"the recording length couldn't be read",no_samples:"no volume samples",partial_coverage:"too little of the recording was analyzed",invalid_energy:"invalid signal values",clipping:"the input was too loud",low_energy:"the input was too quiet",constant_energy:"the input didn't change",too_short:"the recording was too short"};
const num=(v:number|null|undefined,digits=1)=>v!=null?v.toFixed(digits):'–';

/** Dev-only (CAMERA_DEBUG): test condition and anonymous export for validation runs */
function VoiceExport({sessionId,a,v}:{sessionId:string;a:PracticeAnswer;v:DeliverySummary}) {
 const [condition,setCondition]=useState("unspecified");
 return <div className="validation-tools">
  <label>Test condition <select value={condition} onChange={e=>setCondition(e.target.value)}><option value="unspecified">Not recorded</option><option value="quiet">Quiet</option><option value="background-noise">Background noise</option><option value="filler-candidates">Filler-word sentences</option><option value="non-filler-control">Non-filler control sentences</option></select></label>
  <p className="small muted">{EXPORT_NOTICE_EN}</p>
  <button disabled={v.transcriptRevisionMatches===false} onClick={()=>downloadArtifacts([createArtifact("voice",voiceMetrics(v),{attempts:1,totalSec:v.totalSec,analyzedSec:v.analyzedSec,textUnits:v.transcriptUnits,syllables:v.syllables},{runId:getVoiceRunId(sessionId,a.id,a.recorded_at!),condition,reasonCodes:v.reasons,verdicts:{quality:v.quality==="usable"?"pass":"fail"}})])}>Export Voice Summary (JSON)</button>
 </div>;
}

/** One answer's voice numbers from this tab (volume-based estimates, not speech recognition). Hidden when none were measured */
export default function VoiceDelivery({sessionId,a,transcriptDirty,action,onCleared}:{sessionId:string;a:PracticeAnswer;transcriptDirty:boolean;action?:string;onCleared:()=>void}) {
 const raw=a.recorded_at?getVoiceSegment(sessionId,a.id,a.recorded_at,a.transcript??''):undefined;
 if(!raw) return null;
 // An unsaved transcript edit can't be lined up with the recording, so text-based pace and fillers are hidden
 const v=withVoiceTranscript(transcriptDirty?{...raw,transcriptRevisionMatches:false}:raw,a.transcript??'');
 return <div className="delivery-block voice-delivery">
  <h4>Voice</h4>
  <dl className="delivery-metrics">
   <dt>Analyzed</dt><dd data-metric="voice-analyzed">{num(v.analyzedSec)}s of {num(v.totalSec)}s ({Math.round(v.coverage*100)}%)</dd>
   {v.quality==='usable'?<>
    <dt>Speaking</dt><dd data-metric="speaking">{num(v.activeCandidateSec)}s · quiet {v.silenceCandidateRatio!=null?Math.round(v.silenceCandidateRatio*100):'–'}%</dd>
    <dt>Pauses</dt><dd data-metric="pauses">{v.pauseCount??'–'} ({v.longPauseCount??'–'} long) · longest {num(v.longestPauseSec)}s</dd>
   </>:<><dt>Speaking</dt><dd data-metric="speaking">Couldn't analyze: {v.reasons.map(r=>REASON[r]??r).join(', ')||'not enough signal'}</dd></>}
   <dt>Pace</dt><dd data-metric="pace">{num(v.totalPacePerMin,0)} syllables/min overall · {num(v.activeCandidatePacePerMin,0)} while speaking</dd>
   {v.fillers.length>0&&<><dt>Filler words</dt><dd data-metric="fillers"><span lang="ko">{v.fillers.map(f=>`${f.token} ${f.count}`).join(' · ')}</span> (from the transcript)</dd></>}
  </dl>
  {action&&<p className="small"><b>Try:</b> {action}</p>}
  <details className="fold"><summary>Details</summary><ul className="bullets small muted">{v.limitations.map((l,i)=><li key={i}>{l}</li>)}</ul></details>
  <button className="small" onClick={()=>{clearVoiceSegment(sessionId,a.id);onCleared();}}>Clear Voice Results</button>
  {CAMERA_DEBUG&&<VoiceExport sessionId={sessionId} a={a} v={v}/>}
 </div>;
}
