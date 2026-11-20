import { normalize, schema } from './matching.js';

const words = {
  military: {serviceStatus:['병역구분','병역사항','군필여부','병역여부','병역','병역필여부'],branch:['군별','군종'],specialty:['병과'],rankName:['계급','최종계급'],start:['입대일','입영일','복무시작일'],end:['전역일','제대일','복무종료일'],discharge:['전역사유','제대사유','제대구분','전역구분','제대유형','전역유형'],exemption:['면제사유']},
  language: {languageName:['언어','외국어명'],exam:['시험명','어학시험명'],score:['점수','성적','취득점수'],grade:['등급','레벨'],number:['등록번호','수험번호','성적표번호'],date:['취득일'],speaking:['회화','회화수준'],reading:['독해','독해수준'],writing:['작문','작문수준']},
  license: {credential:['자격증','자격증명','자격명'],grade:['등급','자격등급'],number:['등록번호','자격증번호','자격번호'],issuer:['발행처','발급기관','발행기관'],date:['취득일','취득일자']},
  education:{affiliation:['계열','전공계열','학부계열','고교계열','대학계열'],school:['학교명','대학교명','학교','출신학교','대학명','고등학교명','고교명','최종학교명'],tier:['학교구분'],major:['전공','학과','주전공','전공명','학과명','전공학과'],minor:['부전공'],doubleMajor:['복수전공'],location:['소재지','학교소재지'],start:['입학일','입학년월'],end:['졸업일','졸업년월'],status:['졸업구분','졸업상태'],degree:['학위'],gpa:['학점','평점','취득학점'],scale:['만점','기준학점']},
  experience:{company:['회사명','직장명','근무처','근무처명','회사','기관명'],department:['근무부서','부서','부서명'],role:['직무'],position:['직급','직위'],description:['담당업무'],leaving:['사직사유','퇴직사유','퇴사사유'],employmentType:['근무형태','고용형태','구분'],start:['입사일','입사년월'],end:['퇴사일','퇴사년월'],status:['재직구분','재직여부','재직','재직중','현재재직중']},
  activity:{title:['활동명'],organization:['주관기관'],category:['활동구분'],start:['시작년월'],end:['종료년월'],description:['활동내용']},
  award:{title:['수상명'],organization:['수여기관'],date:['수상일'],rank:['수상등급']}
};
const domains={military:/병역|군필|복무/,language:/외국어|어학|공인영어|영어성적/,license:/자격증|자격사항/,education:/학력|고등학교|전문대|대학교|대학원/,experience:/경력|근무경험/,activity:/활동/,award:/수상/};
const clean=s=>normalize(s).replace(/필수$/,'');
export const schoolTiers=['고등학교','전문대학','대학교','편입대학교','대학원','대학원(석사)','대학원(박사)'];
export function schoolTier(value){
  const v=clean(value);
  if(/^(고교|고등학교)$/.test(v))return '고등학교';
  if(/^(전문대|전문대학|전문대학교|[23]년제대학)$/.test(v))return '전문대학';
  if(/^(대학|대학교|4년제대학)$/.test(v))return '대학교';
  if(/^(편입대|편입대학|편입대학교)$/.test(v))return '편입대학교';
  if(/^(대학원)?석사(과정)?$/.test(v))return '대학원(석사)';
  if(/^(대학원)?박사(과정)?$/.test(v))return '대학원(박사)';
  return v==='대학원'?'대학원':'';
}
function formTier(field){
  for(const label of field.schoolLabels||[]){
    const tier=schoolTier(label);
    if(tier==='대학원'){
      const degree=field.anchors?.map(schoolTier).filter(t=>t==='대학원(석사)'||t==='대학원(박사)');
      if(degree?.length===1)return degree[0];
    }
    if(tier)return tier;
  }
  return '';
}
export function resolveRecord(field, archive, sources, host) {
  const label=clean(field.label), section=field.context||field.section||'';
  const anchors=(field.anchors||[]).map(clean).filter(Boolean);
  const tier=formTier(field);
  const education=Boolean(tier)||/학력/.test(field.section||'')||Object.values(words.education).some(names=>names.some(n=>clean(n)===label));
  if(education){
    const key=Object.keys(words.education).find(k=>words.education[k].some(n=>clean(n)===label));
    // A school level the applicant never attended (e.g. 전문대) is left alone, whatever the column.
    if(tier && !(archive.education||[]).some(record=>{const t=schoolTier(record.tier);return t===tier||tier==='대학원'&&t.startsWith('대학원')||tier.startsWith('대학원(')&&t==='대학원';}))return {education:true,absent:true};
    if(!tier)return {education:true,reason:'Unclear which school level this is; left empty.'};
    if(!key)return {education:true,reason:'Not in your archive — fill it in.'};
    const matches=(archive.education||[]).map((record,index)=>({record,index})).filter(({record})=>{
      let stored=schoolTier(record.tier);
      if(stored==='대학원' && schoolTier(record.degree)?.startsWith('대학원('))stored=schoolTier(record.degree);
      return stored===tier || tier==='대학원' && stored.startsWith('대학원(');
    });
    const source=matches.length===1?sources.find(s=>s.group==='education' && s.index===matches[0].index && s.key===key):null;
    return {education:true,source,absent:matches.length===0,reason:matches.length>1?'Several records at this school level.':matches.length===1?'Archive: '+tier+' — '+schema.education[key].split(' ')[0]+' is empty.':tier+': nothing saved, left empty.'};
  }
  const response=(archive.response||[]).map((record,index)=>({record,index})).filter(({record})=>
    record.site?.trim().toLowerCase()===host && record.posting?.trim() && (field.headings||[]).includes(record.posting.trim()) &&
    clean(record.question)===label && !['intro','applydepart','기간','등록번호'].includes(label));
  if(response.length===1)return {source:sources.find(s=>s.group==='response'&&s.index===response[0].index&&s.key==='answer')};
  let pairs=[];
  for(const [group,keys] of Object.entries(words)){
    for(const [key,names] of Object.entries(keys))if(names.some(word=>clean(word)===label))pairs.push({group,key});
  }
  if(!pairs.length)return {reason:'Site-specific question — save an answer for it in your archive.'};
  const contextual=pairs.filter(p=>domains[p.group].test(section) || p.group==='language'&&(archive.language||[]).some(r=>r.exam&&anchors.includes(clean(r.exam))));
  if(contextual.length)pairs=contextual;
  if(pairs.length!==1 || ['구분','등급','등록번호','취득일','기간'].includes(label)&&!contextual.length)
    return {reason:'Unclear which item this is.'};
  const {group}=pairs[0];
  let {key}=pairs[0];
  let records=(archive[group]||[]).map((record,index)=>({record,index}));
  if(!records.length)return {reason:'Add '+schema[group][key]+' to your archive.'};
  const identity={language:'exam',education:'tier',license:'credential',experience:'company'}[group];
  if(identity){
    const identified=records.filter(({record})=>record[identity]&&anchors.includes(clean(record[identity])));
    if(identified.length)records=identified;
    else if(field.recordHint || group==='language' && anchors.some(a=>/toeic|toefl|teps|opic|jlpt|hsk/i.test(a)) ||
      group==='education'&&anchors.some(a=>/^(고등학교|전문대|대학교|편입대학교|석사|박사|대학원)$/.test(a)))
      return {absent:true,reason:'Nothing saved for this row.'};
    else if(field.repeated)return {reason:'Several rows — unclear which record.'};
  }
  if(records.length!==1)return {reason:'Several saved records fit.'};
  const record=records[0].record;
  const blank=v=>!v||/^(해당없음|없음|해당사항없음|na|n\/a|-)$/i.test(clean(v));
  if(group==='language'&&key==='score'&&blank(record.score) && !blank(record.grade) &&
     field.controls?.[0]?.options?.some(option=>clean(option.label)===clean(record.grade)))key='grade';
  const source=sources.find(s=>s.group===group&&s.key===key&&s.index===records[0].index);
  return {source,reason:source?null:'Archive: '+schema[group][key]+' is empty.'};
}

