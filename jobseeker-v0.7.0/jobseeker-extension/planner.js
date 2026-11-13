import { suggest } from './matching.js';
const transforms = new Set(['recordYear','recordMonth','recordDay','identity','phoneDigits','phone0','phone1','phone2','dateISO','monthISO','birthDigits','birthYYMMDD','birthYear','birthMonth','birthDay','emailLocal','emailDomain','literal','option']);
export function validatePlan(plan, field, sources) {
  if (!plan || !sources.some(s => s.path === plan.sourcePath) || !Number.isFinite(plan.confidence) || plan.confidence < 0 || plan.confidence > 1 || !Array.isArray(plan.assignments) || !plan.assignments.length || plan.assignments.length > field.controls.length) throw Error('Could not verify the fill plan.');
  const ids = new Set();
  for (const a of plan.assignments) {
    if (!field.controls.some(c => c.id === a.controlId) || ids.has(a.controlId) || !transforms.has(a.transform)) throw Error('Unsupported field or format.');
    ids.add(a.controlId);
  }
  return { sourcePath: plan.sourcePath, confidence: plan.confidence, reason: String(plan.reason || '').slice(0,300), assignments: plan.assignments.map(a=>({controlId:a.controlId,transform:a.transform})) };
}
export function rulePlan(field, sources) {
  const source = suggest(field, sources); if (!source) return null;
  return planForSource(field,source);
}
export function planForSource(field,source){
  const controls = field.controls;
  if(!controls?.length)return null;
  let kinds = controls.map(()=>'identity');
  if(field.emailParts){
    if(source.key!=='email')return null;
    kinds=field.emailParts.map(part=>part==='local'?'emailLocal':'emailDomain');
  }
  else if(field.datePart && ['start','end','date'].includes(source.key) && controls.length===1) kinds=[{'년':'recordYear','월':'recordMonth','일':'recordDay'}[field.datePart]];
  else if (['phone','emergencyPhone'].includes(source.key) && controls.length === 3) kinds = ['phone0','phone1','phone2'];
  else if (['phone','emergencyPhone'].includes(source.key) && controls.length === 2 && controls.every(c=>c.maxLength===4)) kinds = ['phone1','phone2'];
  else if (source.key === 'birth' && controls.length === 3) kinds = ['birthYear','birthMonth','birthDay'];
  else if(controls.length===1&&controls[0].kind==='date')kinds=['dateISO'];
  else if(controls.length===1&&controls[0].kind==='month')kinds=['monthISO'];
  else if(controls.length===1&&source.key==='birth'&&field.autocomplete?.startsWith('bday-'))kinds=[{'bday-year':'birthYear','bday-month':'birthMonth','bday-day':'birthDay'}[field.autocomplete]];
  else if(controls.length===1&&source.key==='birth'&&controls[0].maxLength===6)kinds=['birthYYMMDD'];
  else if(controls.length===1&&source.key==='birth'&&controls[0].maxLength===8)kinds=['birthDigits'];
  else if(controls.length===1&&['phone','emergencyPhone'].includes(source.key)&&controls[0].maxLength>0&&controls[0].maxLength<=11)kinds=['phoneDigits'];
  else if (source.key === 'email' && field.emailPart) kinds = [field.emailPart==='local'?'emailLocal':'emailDomain'];
  else if (controls.length > 1) return null;
  return { sourcePath:source.path, confidence:0.99, reason:'clear label', assignments:controls.map((c,i)=>({controlId:c.id,transform:kinds[i]})), engine:'Rule' };
}
