import { useId } from 'react';
import { label as nameOf } from '../labels';
import type { ClassificationInput, PracticeTaxonomy, QuestionClassification } from '../types';
export function ClassificationControls({taxonomy,value,onChange,label='Tags'}:{taxonomy:PracticeTaxonomy|null;value:ClassificationInput;onChange:(v:ClassificationInput)=>void;label?:string}) {
 const hint=useId();
 if(!taxonomy?.enabled) return null;
 const keys=value.competency_keys??[];
 return <fieldset className="tag-fields"><legend>{label}</legend><label>Question type<select value={value.question_type??''} onChange={e=>onChange({...value,question_type:e.target.value||null})}><option value="">None</option>{taxonomy.question_types.map(t=><option value={t.key} key={t.key}>{nameOf('questionType',t.key)}</option>)}</select></label>
 <p className="small muted" id={hint}>Competencies this question covers (up to {taxonomy.max_competencies})</p><div className="row small" role="group" aria-labelledby={hint}>{taxonomy.competencies.map(c=><label key={c.key} className="check-label"><input type="checkbox" checked={keys.includes(c.key)} disabled={!keys.includes(c.key)&&keys.length>=taxonomy.max_competencies} onChange={()=>onChange({...value,competency_keys:keys.includes(c.key)?keys.filter(k=>k!==c.key):[...keys,c.key]})}/>{nameOf('competency',c.key)}</label>)}</div></fieldset>;
}
/** Tags saved when the practice started. Nothing shows for answers saved before tags existed. */
export function FrozenClassification({snapshot}:{snapshot:QuestionClassification|null|undefined}) {
 if(!snapshot) return null;
 const followup=snapshot.question_role==='followup';
 if(!snapshot.question_type&&!snapshot.competencies.length&&!followup) return null;
 return <div className="row small"><span className="muted">Tags</span>{snapshot.question_type&&<span className="chip">{nameOf('questionType',snapshot.question_type)}</span>}{snapshot.competencies.map(c=><span className="chip" key={c.key}>{nameOf('competency',c.key)}</span>)}{followup&&<span className="chip">Follow-up</span>}</div>;
}
