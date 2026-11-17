import { archiveRepository } from './repository.js';
import { validateArchive } from './archive.js';
import { schema, groupNames, flatten, suggest, stageSource, profileKey } from './matching.js';
import { connectToTab } from './tab-connection.js';
import { rulePlan, planForSource } from './planner.js';
import { resolveRecord, schoolTiers, schoolTier } from './stage-matching.js';
import { fieldMappings } from './mappings.js';
import { PROVIDERS, AUTO_CONFIDENCE, loadSettings, saveSettings, isReady, originPattern, complete, parseJSON, mapFields, pickCandidate } from './llm.js';
const V = globalThis.JobSeekerValues;
const $ = id => document.getElementById(id);
let archive = await archiveRepository.load();
let sources = flatten(archive), fields = [], targetTab = null, targetFrame = 0;
function node(tag, text, cls) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; }
function status(text) { $('status').textContent = text; }
const suggestions={exam:['TOEIC','TOEFL(IBT)','New TEPS','TOEIC-Speaking','OPIc','JLPT','HSK'],serviceStatus:['군필','미필','면제','복무중','해당없음']};
function renderEditor() {
  $('editor').replaceChildren();
  for(const [key,items] of Object.entries(suggestions)){
    const list=node('datalist');list.id='suggest-'+key;
    items.forEach(value=>{const option=node('option');option.value=value;list.append(option);});
    $('editor').append(list);
  }
  for (const [group, keys] of Object.entries(schema)) {
    const section = node('div'); section.append(node('h2', groupNames[group]));
    const records = group === 'profile' ? [archive.profile] : archive[group];
    records.forEach((record, index) => {
      const card = node('div', undefined, 'card');
      const head = node('div', undefined, 'record-head'); head.append(node('h3', `${groupNames[group]} ${group === 'profile' ? '' : index + 1}`));
      if (group !== 'profile') { const remove = node('button', 'Remove'); remove.onclick = () => { readEditor(); archive[group].splice(index, 1); renderEditor(); }; head.append(remove); }
      card.append(head);
      for (const [key, label] of Object.entries(keys)) {
        const wrapper = node('label', label);
        const input=node(key==='tier'?'select':['description','answer','question'].includes(key)?'textarea':'input');
        if(key==='tier'){
          input.add(new Option('Select school level',''));
          schoolTiers.forEach(t=>input.add(new Option(t,t)));
          if(record.tier && !schoolTier(record.tier))input.add(new Option(record.tier+' (current)',record.tier));
        }
        if(suggestions[key])input.setAttribute('list','suggest-'+key);
        input.value = (key==='tier' && schoolTier(record[key])) || record[key] || ''; input.dataset.group = group; input.dataset.index = index; input.dataset.key = key;
        wrapper.append(input); card.append(wrapper);
      }
      section.append(card);
    });
    if (group !== 'profile') { const add = node('button', `+ ${groupNames[group]}`); add.onclick = () => { readEditor(); archive[group].push({}); renderEditor(); }; section.append(add); }
    $('editor').append(section);
  }
}
function readEditor() {
  for (const input of $('editor').querySelectorAll('[data-key]')) {
    const { group, index, key } = input.dataset;
    (group === 'profile' ? archive.profile : archive[group][index])[key] = input.value.trim();
  }
}
function resetPlan() { fields = []; $('fields').replaceChildren();  $('fill').disabled = true; }
async function connect() {
  resetPlan();
  const tab = await connectToTab(chrome);
  targetTab = tab.id;
  return tab;
}
async function send(type, payload = {}) {
  if (!targetTab) throw Error('Connect the page, then click a field.');
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.id !== targetTab && !(fields[0]?.kind==='address'&&active?.openerTabId===targetTab)) throw Error('Tab changed. Reconnect and click the field again.');
  const reply = await chrome.tabs.sendMessage(targetTab, { type, ...payload }, {frameId:targetFrame});
  if (reply?.error) throw Error(reply.error);
  return reply;
}
function report(text, warn = false) { $('results').append(node('div', text, `result${warn ? ' warn' : ''}`)); }


// ---- Shared decision helpers -------------------------------------------
const textLike=field=>field.controls.length===1&&!field.emailParts&&!field.datePart&&!field.catalog&&['text','search','textarea','url',''].includes(field.controls[0].kind);
// Choices that are the applicant's decision (posting, job, consent) or already filled never go to the AI.
const aiEligible=field=>Boolean(field.label)&&field.controls[0]?.kind!=='textarea'&&field.kind!=='address'&&!field.value&&
  !/채용공고|공고|지원분야|지원직무|지원부문|모집분야|희망직무|직무선택|지원지역|근무지|동의|약관|비밀번호|인증|보안문자|captcha/i.test(field.label);
// Rule-level fitting of a stored text to the form's printed suffix / instructions.
function adapt(field,source,plan){
  if(!plan||!source||!textLike(field)||plan.assignments.length!==1||plan.assignments[0].transform!=='identity')return {plan};
  const r=V.adaptText(source.value,field.hints||{},field.controls[0].maxLength);
  if(r.changed)return {plan:{...plan,assignments:[{controlId:plan.assignments[0].controlId,transform:'literal',literal:r.value}]},note:r.reason};
  return {plan,needsJudgment:r.needsJudgment,tooLong:r.tooLong};
}
function planFromAI(field,result){
  let plan;
  if(result.option!=null)plan={sourcePath:result.source.path,assignments:[{controlId:'c0',transform:'option',literal:result.option}]};
  else{
    plan=planForSource(field,result.source);
    if(!plan)return null;
    if(result.literal!=null)plan.assignments=[{controlId:plan.assignments[0].controlId,transform:'literal',literal:result.literal}];
  }
  return {...plan,confidence:result.confidence,engine:'AI',reason:result.reason||'AI'};
}
const shownValue=(plan,source)=>plan?.assignments?.length===1&&plan.assignments[0].literal!=null?plan.assignments[0].literal:source?.value;

// A search popup opened by the form (school, major, address) may hold focus for a while.
// Wait for it instead of treating it as the user leaving the page.
async function waitForFormTab(tabId){
  for(let i=0;i<120;i++){
    const [active]=await chrome.tabs.query({active:true,lastFocusedWindow:true});
    if(active?.id===tabId)return;
    if(active?.openerTabId!==tabId)throw Error('Stopped: the active tab changed.');
    // A popup this form opened is fine: the remaining fields are filled in the background.
    return;
    if(i===0)status('Waiting for the search popup…');
    await new Promise(r=>setTimeout(r,500));
  }
  throw Error('Search popup timed out. Close it and try again.');
}
// Site alert() popups (e.g. "병역필을 선택하셨습니다") block the page while values change.
// During the run they are collected and shown in the panel instead; confirm() is left untouched.
async function holdAlerts(tabId,on){
  const results=await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',args:[on],func:on=>{
    if(on){if(!window.__jobseekerAlert){window.__jobseekerAlert=window.alert;window.__jobseekerAlerts=[];window.alert=m=>{window.__jobseekerAlerts.push(String(m).slice(0,200));};}return [];}
    const seen=window.__jobseekerAlerts||[];if(window.__jobseekerAlert){window.alert=window.__jobseekerAlert;delete window.__jobseekerAlert;}delete window.__jobseekerAlerts;return seen;
  }}).catch(()=>[]);
  return [...new Set(results.flatMap(r=>r.result||[]))];
}
let stageRunning=false, alertTab=null, reviewSession=null;
// ---- After the run: suggestions to confirm, then the blanks left for the user -------------
const AFFILIATION=[['공학',/공학|컴퓨터|소프트웨어|전자|전기|기계|화공|건축|토목|산업공|신소재|정보통신|반도체/],['상경',/경영|경제|회계|무역|금융|세무|유통|마케팅|통상/],['사범',/교육/],['법과',/법학|법률/],['의약',/의학|약학|치의|한의|보건|의료/],['간호',/간호/],['사회',/행정|정치|사회|심리|미디어|언론|신문방송|외교|복지|광고/],['자연',/수학|물리|화학|생물|통계|천문|지구|생명|식품|환경/],['인문',/국문|국어|영문|영어|불문|독문|중문|일문|사학|철학|문헌|언어|문학|어문/],['예체능',/미술|음악|체육|디자인|무용|연극|영화|조형|스포츠/],['농림',/농|임학|산림|원예|축산/],['축수산',/수산|해양생|양식/],['가정',/가정|의류|아동|소비자/]];
function guessAffiliation(major,options){
  for(const [name,re] of AFFILIATION)if(re.test(major||'')){const hit=options.find(o=>V.core(o.label)===V.core(name));if(hit)return hit.label;}
  return null;
}
async function endReview(){
  const session=reviewSession;reviewSession=null;
  if(session)for(const send of session.opened)await send('JS_STAGE_END').catch(()=>{});
}
function renderReview(ctx){
  const box=$('review');box.replaceChildren();
  if(ctx.suggestions.length){
    box.append(node('h2','Confirm before applying ('+ctx.suggestions.length+')'),node('p','Suggested values. Check, then apply.','muted'));
    const cards=[];
    for(const s of ctx.suggestions){
      const card=node('div',undefined,'card suggestion');
      const value=s.option??s.literal??s.source.value;
      card.append(node('h3',s.field.label),node('small',value+'  ←  '+s.source.label+' · '+s.engine+(s.confidence!=null?' '+Math.round(s.confidence*100)+'%':'')+(s.reason?' · '+s.reason:'')));
      const actions=node('div',undefined,'actions'),apply=node('button','Apply','primary'),skip=node('button','Skip'),look=node('button','Show');
      const done=(text,warn)=>{actions.replaceChildren(node('span',text,warn?'result warn':'result'));s.done=true;if(ctx.suggestions.every(x=>x.done))endReview();};
      apply.onclick=async()=>{apply.disabled=true;try{
        await applySource({...ctx,phaseB:true},s.field,s.source,s.send,{engine:s.engine+' (confirmed)',literal:s.literal,option:s.option,kind:s.kind});
        if(s.learn&&s.engine==='AI'&&!['education','response'].includes(s.source.group))await fieldMappings.save(ctx.origin,s.field,s.source).catch(()=>{});
        done('Applied.');}catch(error){done(error.message,true);}};
      skip.onclick=()=>{done('Skipped — fill it in yourself.',true);};
      look.onclick=()=>s.send('JS_FOCUS_FIELD',{token:s.field.token}).catch(()=>{});
      actions.append(apply,skip,look);card.append(actions);box.append(card);cards.push({s,apply});
    }
    const all=node('button','Apply all','primary');
    all.onclick=async()=>{all.disabled=true;for(const {s,apply} of cards)if(!s.done)await apply.onclick();};
    const finish=node('button','Done');finish.onclick=()=>{for(const s of ctx.suggestions)s.done=true;endReview();finish.disabled=true;};
    const row=node('div',undefined,'actions');row.append(all,finish);box.append(row);
  }
  if(ctx.reviews?.length){
    // Already filled with the closest search result: the user only has to look.
    box.append(node('h2','Please check ('+ctx.reviews.length+')'),node('p','No exact match, so the closest one was filled in. Re-pick on the page if it is wrong.','muted'));
    for(const r of ctx.reviews){
      const card=node('div',undefined,'card review');
      card.append(node('h3',r.field.label),node('small','Saved "'+r.stored+'"  →  filled "'+r.picked+'"'+(r.score!=null?' · match '+Math.round(r.score*100)+'%':' · '+(r.how&&r.how!=='AI'?r.how:'AI'))));
      if(r.others?.length)card.append(node('small','Other options: '+r.others.join(', '),'muted'));
      const actions=node('div',undefined,'actions'),look=node('button','Show'),ok=node('button','Looks right','primary');
      look.onclick=()=>r.send('JS_FOCUS_FIELD',{token:r.field.token}).catch(()=>status('The page changed; cannot locate it.'));
      ok.onclick=()=>{actions.replaceChildren(node('span','Checked','result'));card.classList.add('checked');};
      actions.append(look,ok);card.append(actions);box.append(card);
    }
  }
  if(ctx.missed?.length){
    box.append(node('h2','Not handled ('+ctx.missed.length+')'),node('p','Fields the extension did not touch. Fill them in yourself.','muted'));
    const list=node('div',undefined,'blank-list');box.append(list);
    for(const m of ctx.missed){const item=node('button',m.label+' · '+m.kind,'blank');item.onclick=()=>m.send('JS_FOCUS_MISSED',{index:m.index}).catch(()=>status('The page changed; cannot locate it.'));list.append(item);}
  }
  const blanks=ctx.blanks.filter((b,i,a)=>a.findIndex(x=>x.label===b.label&&x.message===b.message)===i);
  if(blanks.length){
    box.append(node('h2','Needs your input ('+blanks.length+')'),node('p','Click an item to find it on the page.','muted'));
    const list=node('div',undefined,'blank-list');box.append(list);
    for(const b of blanks){
      const item=node('button',b.label+' — '+b.message,'blank');
      item.onclick=()=>b.send?.('JS_FOCUS_FIELD',{token:b.token}).catch(()=>status('The page changed; cannot locate it.'));
      list.append(item);
    }
  }
}
async function fillStage() {
  if(stageRunning)return;
  await endReview();$('review').replaceChildren();
  stageRunning=true;
  $('stage').disabled=true;
  $('results').replaceChildren();
  const opened=[];
  try {
    const saved=await archiveRepository.load();
    const values=flatten(saved);
    if(!values.length)throw Error('Save your archive first.');
    const settings=await loadSettings();
    const tab=await connect();
    const [frame]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>location.href});
    if(frame.result!==tab.url)throw Error('The page changed. Run again.');
    const id=crypto.randomUUID();
    const host=new URL(tab.url).hostname, origin=new URL(tab.url).origin;
    const ctx={saved,values,host,origin,female:isFemale(saved),ai:isReady(settings),deferred:[],suggestions:[],blanks:[],missed:[],reviews:[],totals:{completed:0,pending:0,absent:0,ai:0,skipped:0},warnings:new Map()};
    // Forms embedded in iframes are filled too, each frame in its own pass.
    let frames=[{frameId:0,url:tab.url}];
    try{frames=(await chrome.webNavigation.getAllFrames({tabId:tab.id})).filter(f=>/^https?:/.test(f.url)).sort((a,b)=>(a.frameId===0?-1:1)-(b.frameId===0?-1:1));}catch{}
    const unreachable=[];
    alertTab=tab.id;await holdAlerts(tab.id,true);
    status('Filling this step…');
    for(const target of frames){
      const send=async(type,payload={})=>{
        const reply=await chrome.tabs.sendMessage(tab.id,{type,id,...payload},{frameId:target.frameId});
        if(!reply||reply.error)throw Error(reply?.error||'Lost connection to the page.');
        return reply;
      };
      try{await send('JS_STAGE_BEGIN');}catch{
        // Captcha, ads and analytics frames are not part of the application.
        if(target.frameId!==0&&!/recaptcha|google\.com|gstatic|googletagmanager|doubleclick|facebook|youtube|naver\.com|criteo|hotjar|channel\.io/i.test(target.url))unreachable.push(target.url);
        continue;}
      opened.push(send);
      for(let count=0;;count++){
        if(count>=250)throw Error('Too many fields in one step.');
        await waitForFormTab(tab.id);
        const {field}=await send('JS_STAGE_NEXT');
        // A licence that still has a table to try, but no empty box there: add a row with that table's own button.
        if(!field&&ctx.licence&&ctx.credentialFrame===send&&(ctx.rowsAdded||0)<10){
          const L=ctx.licence,lic=ctx.saved.license||[];
          const tried=i=>L.tried.get(i)||L.tried.set(i,new Set()).get(i);
          const next=lic.findIndex((r,i)=>String(r.credential||'').trim()&&!L.done.has(i)&&L.tables.some(t=>!tried(i).has(t)));
          if(next>=0){
            const table=L.tables.find(t=>!tried(next).has(t));
            const added=await send('JS_ADD_ROW',{topic:'credential',section:table}).catch(error=>({ok:false,message:error.message}));
            if(added.ok){ctx.rowsAdded=(ctx.rowsAdded||0)+1;L.addedPending=true;report(table+': added a row for "'+lic[next].credential+'".');continue;}
            tried(next).add(table);report(table+': could not add a row — '+added.message,true);continue;
          }
          const skipped=lic.filter((r,i)=>String(r.credential||'').trim()&&!L.done.has(i)).map(r=>r.credential);
          if(skipped.length&&!L.reported){L.reported=true;report('Not found in any certificate list, skipped: '+skipped.join(', '));}
        }
        if(!field){
          // Coverage check: visible questions this run never reached are listed, never silently dropped.
          const {missed=[]}=await send('JS_STAGE_COVERAGE',{female:ctx.female}).catch(()=>({}));
          for(const m of missed)ctx.missed.push({...m,send});
          break;
        }
        try{await handleField(ctx,field,send);}
        catch(error){warn(ctx,field.label,error.message,field,send);}
      }
    }
    if(ctx.deferred.length){
      status('Asking AI about '+ctx.deferred.length+' field(s)…');
      const results=await mapFields(ctx.deferred,values,settings,{onProgress:(done,total)=>status('Asking AI… '+done+'/'+total+'')});
      for(const item of ctx.deferred){
        const r=results.get(item.id)||{error:'No AI answer'};
        if(r.error){warn(ctx,item.field.label,r.error,item.field,item.send);continue;}
        ctx.suggestions.push({field:item.field,send:item.send,source:r.source,literal:r.literal,option:r.option,engine:'AI',confidence:r.confidence,reason:r.reason,learn:!item.source});
      }
    }
    if(unreachable.length){
      lastFrameOrigins=[...new Set(unreachable.map(u=>new URL(u).origin+'/*'))];
      report('Could not reach '+unreachable.length+' embedded frame(s). Use "Allow this site" for '+lastFrameOrigins.join(', ')+', then run again.',true);
    }
    if(ctx.suggestions.length){
      // Keep the stage open so confirmed suggestions can still reach their fields.
      for(const send of opened)await send('JS_STAGE_REVIEW').catch(()=>{});
      reviewSession={opened:[...opened],ctx};opened.length=0;
    }
    renderReview(ctx);
    const t=ctx.totals;
    status('Filled '+t.completed+''+(t.ai?' (AI '+t.ai+')':'')+(ctx.reviews.length?' · to check '+ctx.reviews.length+'':'')+' · need input '+t.pending+' · no data '+t.absent+''+(ctx.ai?'':' · AI off')+'. Review before moving on.');
  }finally{
    for(const send of opened)await send('JS_STAGE_END').catch(()=>{});
    if(alertTab){const messages=await holdAlerts(alertTab,false);alertTab=null;for(const m of messages)report('Site alert: '+m);}
    stageRunning=false;$('stage').disabled=false;
  }
}
function warn(ctx,label,message,field,send){
  // Not a to-do: 비대상 rows' number boxes, and 병역사항 for women (left blank or 해당없음).
  if(field?.gatedOff||field?.military&&ctx.female){ctx.totals.absent++;return;}
  if(label&&ctx.doneLabels?.has(label)&&/Several options fit|No matching option/.test(message))return;
  ctx.totals.pending++;
  ctx.blanks.push({label:label||'Unnamed field',message,token:field?.token,send});
  const key=(label||'Unnamed field')+' · '+message;
  const item=ctx.warnings.get(key)||{count:0,el:node('div',key,'result warn')};
  item.count++;
  if(item.count===1){ctx.warnings.set(key,item);$('results').append(item.el);}
  else item.el.textContent=key+' ('+item.count+' fields)';
}
function defer(ctx,field,source,send,reason){
  ctx.deferred.push({id:'f'+ctx.deferred.length,field,source,send,reason});
}
const isFemale=saved=>/^(여|여성|여자|female|f)$/i.test(String(saved?.profile?.gender||'').trim());
// A stored record that actually says the person served (a woman who served still gets it filled).
const servedMilitary=saved=>(saved?.military||[]).some(r=>/군필|병역필|복무|전역|제대|소집해제|만기/.test(String(r.serviceStatus||''))&&!/미필|해당없음|면제/.test(String(r.serviceStatus||'')));
async function handleField(ctx,field,send){
  if(!field.label){ctx.totals.skipped++;return;}
  if(field.gatedOff){ctx.totals.absent++;return;}
  if(field.military&&ctx.female&&!servedMilitary(ctx.saved)){
    const none=field.controls?.[0]?.options?.find(o=>/^(해당없음|해당사항없음|비대상)$/.test(String(o.label||'').replace(/\s/g,'')));
    if(none&&field.controls.length===1&&!field.value)return applySource(ctx,field,{group:'military',key:'serviceStatus',label:'Military (female)',value:none.label,path:'military.female'},send,{engine:'Rule',option:none.label,note:'female · not applicable'}).catch(()=>{ctx.totals.absent++;});
    ctx.totals.absent++;return;
  }
  // 자격증 boxes: each stored licence is searched table by table (see fillLicenceBox).
  if(field.catalog==='credential'&&(ctx.saved.license||[]).some(r=>String(r.credential||'').trim()))return fillLicenceBox(ctx,field,send);
  // 등록번호/취득일 in a licence table follow the licence that row's box received; an unused row stays empty.
  if(!field.catalog&&ctx.licence?.tables.includes(field.section)){
    if(!ctx.lastLicence||ctx.lastLicence.section!==field.section){ctx.totals.absent++;return;}
    const own=licenceFor(ctx,field,ctx.lastLicence.index);
    if(!own.source){ctx.totals.absent++;return;}
    return applySource(ctx,field,own.source,send,{engine:'Same row'});
  }
  const match=resolveRecord(field,ctx.saved,ctx.values,ctx.host);
  if(match.absent){ctx.totals.absent++;return;}
  let source=match.education?match.source:stageSource(field,ctx.values)||match.source, engine='Rule';
  if(!source&&!match.education){
    const learned=await fieldMappings.find(ctx.origin,field,ctx.values);
    if(learned&&!['response','education'].includes(learned.group)){source=learned;engine='Saved link';}
  }
  // 계열: stored value first, otherwise an estimate from the major, confirmed by the user.
  if(!source&&field.label==='계열'&&field.controls[0]?.options?.length){
    const major=resolveRecord({...field,label:'전공'},ctx.saved,ctx.values,ctx.host).source;
    const guess=major&&guessAffiliation(major.value,field.controls[0].options);
    if(guess){ctx.suggestions.push({field,send,source:major,option:guess,engine:'Guessed from major',reason:major.value+' → '+guess});return;}
  }
  // "[부/복수 ▾] [전공검색]": a stored double major takes the box, otherwise the minor.
  if(field.catalog==='major'&&/^(부전공|복수전공)$/.test(field.label)){
    const double=resolveRecord({...field,label:'복수전공'},ctx.saved,ctx.values,ctx.host).source;
    const minor=resolveRecord({...field,label:'부전공'},ctx.saved,ctx.values,ctx.host).source;
    if(double||minor)return applySource(ctx,field,double||minor,send,{engine:'Rule',kind:double?'복수':'부'});
  }
  if(!source&&!match.education){const key=profileKey(field);if(key&&!String(ctx.saved.profile?.[key]||'').trim()){ctx.totals.absent++;return;}}
  if(!source){
    if(ctx.ai&&aiEligible(field)&&!/Several rows|Several records at/.test(match.reason||''))return defer(ctx,field,null,send,match.reason);
    throw Error(match.reason||'No saved answer.');
  }
  await applySource(ctx,field,source,send,{engine});
}
// Licence tables differ by site (필수/기타, 국가/민간 …) and only the site's own search knows which
// licence belongs where. Each box tries the stored licences that have not yet been tried in its table;
// a licence the search does not find moves on to the next table, and one no table finds is not written.
async function fillLicenceBox(ctx,field,send){
  const table=field.section||field.name||'Certificates';
  const L=ctx.licence??={done:new Set(),tried:new Map(),tables:[],addedPending:false};
  if(!L.tables.includes(table))L.tables.push(table);
  const added=L.addedPending;L.addedPending=false;
  ctx.lastLicence=null;ctx.credentialFrame=send;
  const licences=ctx.saved.license||[];
  if(field.value){
    // Already on the page: count the stored licence it shows as placed.
    const i=licences.findIndex((r,i)=>!L.done.has(i)&&r.credential&&V.core(r.credential)===V.core(field.value));
    if(i>=0){L.done.add(i);ctx.lastLicence={index:i,section:field.section};}
    ctx.totals.absent++;return;
  }
  const tried=i=>L.tried.get(i)||L.tried.set(i,new Set()).get(i);
  const pending=licences.map((r,i)=>i).filter(i=>String(licences[i].credential||'').trim()&&!L.done.has(i)&&!tried(i).has(table));
  for(const i of pending){
    const source=ctx.values.find(s=>s.path===`license.${i}.credential`);if(!source)continue;
    status(table+': searching "'+source.value+'"…');
    const opened=await send('JS_CATALOG_OPEN',{stage:true,cascade:true,token:field.token,topic:'credential',query:source.value,terms:[],extras:catalogExtras(ctx,source),issuer:licences[i].issuer||undefined})
      .catch(error=>({ok:false,error:error.message}));
    if(opened.ok){
      L.done.add(i);ctx.lastLicence={index:i,section:field.section};
      if(opened.review)ctx.reviews.push({field,send,stored:source.value,...opened.review});
      ctx.totals.completed++;
      report(field.label+' · '+table+' → "'+source.value+'"'+(opened.review?' · closest match, please check':' · filled'));
      return;
    }
    if(opened.notFound){tried(i).add(table);report(table+': "'+source.value+'" not listed, trying the next list.');continue;}
    // Blocked popup, a box that already holds something, …: stop here and let the user see why.
    throw Error(opened.error||opened.message||'Could not confirm the certificate search.');
  }
  // No stored licence belongs in this box. A row this run added for the attempt is removed again.
  if(added)await send('JS_REMOVE_ROW',{token:field.token}).then(r=>{if(r.ok)report(table+': removed the unused row.');}).catch(()=>{});
  ctx.totals.absent++;
}
// Resolve a licence-table field against one stored licence only.
function licenceFor(ctx,field,index){
  const record=ctx.saved.license?.[index];if(!record)return {};
  const values=ctx.values.filter(s=>s.group!=='license'||s.index===index).map(s=>s.group==='license'?{...s,index:0}:s);
  const r=resolveRecord(field,{...ctx.saved,license:[record]},values,ctx.host);
  if(r.source?.group==='license')return {source:r.source};
  // A licence-table column this licence leaves blank (SQLD has no 발행처): nothing to type.
  return {empty:/is empty\./.test(r.reason||'')};
}
// What a search popup may ask for next to the chosen result.
function catalogExtras(ctx,source){
  const r=ctx.saved[source.group]?.[source.index]||{};
  if(source.group==='license')return {'발급기관':r.issuer,'발행처':r.issuer,'등록번호':r.number,'자격번호':r.number,'취득일자':r.date,'취득일':r.date};
  if(source.group==='education'&&source.key==='school')return {'대학계열':r.affiliation,'계열':r.affiliation,'소재지':r.location};
  return undefined;
}
async function applySource(ctx,field,source,send,{engine,literal,option,note,kind}={}){
  let detail='';
  if(field.catalog){
    // One stored licence/major goes into one box, even when the form has two tables for it.
    if(source.key!==field.catalog && field.catalog!=='generic' && !(field.catalog==='major' && ['minor','doubleMajor'].includes(source.key)))throw Error('Saved item does not match this search.');
    const opened=await send('JS_CATALOG_OPEN',{stage:true,token:field.token,topic:field.catalog,query:source.value,kind,terms:literal?[literal]:[],extras:catalogExtras(ctx,source),issuer:source.group==='license'?ctx.saved.license[source.index].issuer:undefined});
    detail='filled';
    if(opened?.review){ctx.reviews.push({field,send,stored:source.value,...opened.review});detail='closest match, please check';}
  }else if(field.kind==='address'){
    if(source.key!=='address')throw Error('Check the saved address.');
    const result=await send('JS_ADDRESS_OPEN',{stage:true,token:field.token,query:source.value,postcode:ctx.saved.profile.postcode,detail:ctx.saved.profile.addressDetail});
    if(!result.ok)throw Error(result.message);
    detail='filled';
    if(result.review){ctx.reviews.push({field,send,stored:source.value,...result.review});detail='closest address, please check';}
  }else{
    if(source.key==='addressDetail'&&field.needsVerifiedAddress)throw Error('Fill the main address first.');
    let plan;
    if(option!=null)plan={assignments:[{controlId:'c0',transform:'option',literal:option}]};
    else{
      plan=planForSource(field,source);
      if(!plan){if(ctx.ai&&!ctx.phaseB)return defer(ctx,field,source,send,'format needs a judgment');throw Error('Check the input format.');}
      if(literal!=null)plan.assignments=[{controlId:plan.assignments[0].controlId,transform:'literal',literal}];
      else{
        const fitted=adapt(field,source,plan);plan=fitted.plan;
        if(fitted.note)note=fitted.note;
        if(fitted.needsJudgment){
          if(ctx.ai&&!ctx.phaseB)return defer(ctx,field,source,send,'format hint needs a judgment');
          if(fitted.tooLong)throw Error('Saved value is longer than the field ('+field.controls[0].maxLength+' chars). Shorten it yourself.');
        }
      }
    }
    const result=await send('JS_FILL',{stage:true,token:field.token,value:source.value,assignments:plan.assignments,expectedValues:field.controls.map(c=>c.value),overwrite:false});
    if(!result.ok)throw Error(result.message);
    const typed=shownValue(plan,source);
    detail=(typed!==source.value?'"'+typed+'" filled':'filled')+(/Picked "/.test(result.message)?' · '+result.message.split(' · ').slice(1).join(' · '):'');
  }
  ctx.totals.completed++;
  (ctx.doneLabels??=new Set()).add(field.label);
  report(field.label+' · '+detail+(engine&&engine!=='Rule'?' · '+engine:'')+(note?' ('+note+')':''));
}
let selectionGeneration = 0, activePlan = null, lastFrameOrigins=[], selectedOrigin='';
async function applyCurrent() {
  const field=fields[0],plan=activePlan;
  const route={tabId:targetTab,frameId:targetFrame,generation:selectionGeneration};
  if(!field||!plan)throw Error('Select the field again.');
  const source=sources.find(item=>item.path===plan.sourcePath);if(!source)throw Error('Nothing to link.');
  if(field.kind==='address'&&source.key!=='address')throw Error('Link your saved address to the address search.');
  const current=await archiveRepository.load();if(current.revision!==archive.revision)throw Error('Archive changed. Select the field again.');
  if(route.generation!==selectionGeneration||route.tabId!==targetTab||route.frameId!==targetFrame)throw Error('Stopped: the field changed.');
  $('fill').disabled=true;
  const [activeTab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});
  if(route.generation!==selectionGeneration)throw Error('Stopped: the field changed.');
  let result;
  try{result=field.kind==='address'?
    await send(activeTab?.openerTabId===route.tabId?'JS_ADDRESS_PREPARE':'JS_ADDRESS_OPEN',{token:field.token,query:source.value,postcode:current.profile.postcode,detail:current.profile.addressDetail}):
    await send('JS_FILL',{token:field.token,value:source.value,assignments:plan.assignments,expectedValues:field.controls.map(c=>c.value),overwrite:$('overwrite').checked});}
  catch(error){if(route.generation===selectionGeneration)$('fill').disabled=false;throw error;}
  report(`${field.label} · ${plan.engine}: ${result.message}`,!result.ok);
  status(result.ok?'Done. Check the page.':'Check the result.');
}
async function showTarget(field,tabId,frameId=0,pageUrl='') {
  const generation=++selectionGeneration;
  resetPlan();activePlan=null;$('preview').textContent='';
  if(!field){status('Click a field on the page.');return;}
  targetTab=tabId;targetFrame=frameId;
  try{selectedOrigin=new URL(pageUrl).origin;}catch{selectedOrigin='';}
  const loaded=await archiveRepository.load();if(generation!==selectionGeneration)return;
  archive=loaded;sources=flatten(archive);fields=[field];$('overwrite').checked=false;
  const card=node('div',undefined,'card');card.append(node('h3',field.label||'Unnamed field'));
  card.append(node('small',`${field.controls.length} input(s) · ${field.kind} · now: ${field.value||'empty'}`));
  const select=node('select');select.dataset.field=field.token;
  select.setAttribute('aria-label',`${field.label} — saved item`);
  const empty=node('option','Finding a match…');empty.value='';select.append(empty);
  for(const source of sources){const option=node('option',`${source.label} → ${source.value}`);option.value=source.path;select.append(option);}
  card.append(select);$('fields').append(card);
  const match=resolveRecord(field,archive,sources,new URL(pageUrl||'https://localhost').hostname);
  let plan=match.source?planForSource(field,match.source):match.education?null:rulePlan(field,sources.filter(s=>s.group!=='education'));
  if(plan&&!plan.engine)plan.engine='Rule';
  const learnedSource=await fieldMappings.find(selectedOrigin,field,sources);
  if(generation!==selectionGeneration)return;
  if(!match.education && learnedSource && !['response','education'].includes(learnedSource.group)){const learned=planForSource(field,learnedSource);if(learned)plan={...learned,engine:'Saved link',reason:'your choice on this site'};}
  if(field.kind==='address') {
    const address=sources.find(source=>source.path==='profile.0.address');
    if(address)plan={sourcePath:address.path,confidence:.99,reason:'clicked address field',assignments:[],engine:'Address helper'};
  }
  if(generation!==selectionGeneration)return;
  // Fit the stored text to the form, then let the AI decide only what rules could not.
  const aiSettings=await loadSettings();
  let aiItem=null;
  if(plan&&plan.engine!=='Address helper'){
    const src=sources.find(item=>item.path===plan.sourcePath);
    const fitted=adapt(field,src,plan);
    plan={...fitted.plan,engine:plan.engine,reason:fitted.note||plan.reason,confidence:plan.confidence};
    if(fitted.needsJudgment&&isReady(aiSettings))aiItem={id:'f0',field,source:src};
  }
  if(!plan&&!match.education&&isReady(aiSettings)&&aiEligible(field))aiItem={id:'f0',field};
  if(aiItem){
    $('preview').textContent='Asking AI…';
    const r=(await mapFields([aiItem],sources,aiSettings).catch(error=>new Map([['f0',{error:error.message}]]))).get('f0');
    if(generation!==selectionGeneration)return;
    if(r&&!r.error){
      const proposal=planFromAI(field,r);
      if(proposal)plan=proposal;
      if(r.confidence<AUTO_CONFIDENCE)report(field.label+': AI confidence '+Math.round(r.confidence*100)+'% — check before applying.',true);
    }else if(r)report(field.label+': '+r.error,true);
  }
  if(!plan){empty.textContent='No match — pick a saved item';report(`${field.label}: no match. Pick a saved item or type it on the site.`,true);}
  function setPlan(next){activePlan=next;select.value=next?.sourcePath||'';$('fill').disabled=!next;
    const source=sources.find(item=>item.path===next?.sourcePath);
    $('preview').textContent=next?`${next.engine} · ${next.reason} · ${shownValue(next,source)} → ${field.label}`:'Pick a saved item.';
  }
  setPlan(plan);
  select.onchange=async()=>{
    const source=sources.find(item=>item.path===select.value);
    if(!source){setPlan(null);await fieldMappings.forget(selectedOrigin,field);return;}
    const proposal=field.kind==='address'&&source.key==='address'?{sourcePath:source.path,confidence:1,assignments:[]}:planForSource(field,source);
    if(!proposal){setPlan(null);report('Could not split this value. Type it on the site.',true);return;}
    setPlan({...proposal,engine:'Manual link',reason:'item you linked'});
    try{await fieldMappings.save(selectedOrigin,field,source);if(generation!==selectionGeneration)return;if($('auto-fill').checked)await applyCurrent();}
    catch(error){report(error.message,true);}
  };
  if(plan&&plan.confidence>=.9&&$('auto-fill').checked){
    try{await applyCurrent();}catch(error){report(error.message,true);status('Auto-fill stopped. Check the field.');}
  }else status('Check the suggestion or link one yourself.');
}
async function scan(){
  $('results').replaceChildren();
  const tab=await connect();targetFrame=0;
  await chrome.runtime.sendMessage({type:'JS_RESUME_ADDRESS',tabId:tab.id}).catch(()=>{});
  const result=await send('JS_SELECTED');
  lastFrameOrigins=result.frameOrigins||[];
  $('page-info').textContent=`${new URL(tab.url).hostname} · auto-fill on click · frames: ${result.frames}`;
  await showTarget(result.field,tab.id,0,tab.url);
}
chrome.runtime.onMessage.addListener((message,sender)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(message.type==='JS_NOTICE'){report(message.message,message.warn);return;}
  if(stageRunning||message.type!=='JS_TARGET'||!sender.tab?.id)return;
  chrome.tabs.query({active:true,lastFocusedWindow:true}).then(([tab])=>{
    if(tab?.id!==sender.tab.id&&!(message.field?.kind==='address'&&tab?.openerTabId===sender.tab.id))return;
    $('archive-view').hidden=true;$('apply-view').hidden=false;
    $('archive-tab').setAttribute('aria-pressed','false');$('apply-tab').setAttribute('aria-pressed','true');
    return showTarget(message.field,sender.tab.id,sender.frameId||0,sender.url||sender.tab.url||tab.url);
  }).catch(error=>status(error.message));
});
chrome.tabs.onActivated?.addListener(()=>{selectionGeneration++;resetPlan();targetTab=null;activePlan=null;$('preview').textContent='';status('Select a field in the new tab.');});
function guard(fn) { return async (...args) => { try { await fn(...args); } catch (error) { status(error.message); report(error.message, true); } }; }
for (const view of ['archive', 'apply']) $(view + '-tab').onclick = () => {
  for (const other of ['archive', 'apply']) { $(other + '-view').hidden = other !== view; $(other + '-tab').setAttribute('aria-pressed', String(other === view)); }
};
$('save').onclick = guard(async () => { readEditor();
  const missingTier=archive.education.findIndex(record=>!record.tier && Object.values(record).some(Boolean));
  if(missingTier>=0)throw Error('Education '+(missingTier+1)+': select the school level.');
  archive = await archiveRepository.save(validateArchive(archive)); sources = flatten(archive); resetPlan(); status(`Archive v${archive.revision} saved`); });
$('stage').onclick=guard(fillStage);
$('scan').onclick = guard(scan);


$('fill').onclick=guard(applyCurrent);
$('clear-mappings').onclick=guard(async()=>{await fieldMappings.clear();status('Saved field links cleared.');});
$('grant-site').onclick=guard(async()=>{
  const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});
  if(!/^https?:/.test(tab?.url||''))throw Error('Open a web page first.');
  const origin=new URL(tab.url).origin+'/*';
  const granted=await chrome.permissions.request({origins:[...new Set([origin,...lastFrameOrigins])]});
  if(!granted)throw Error('Site access was not granted.');
  await scan();
});
$('export').onclick = guard(async () => {
  const saved = await archiveRepository.load(); const url = URL.createObjectURL(new Blob([JSON.stringify(saved, null, 2)], { type: 'application/json' }));
  const a = node('a'); a.href = url; a.download = 'jobseeker-archive.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 3000); status('Exported (contains personal data).');
});
$('import').onchange = guard(async event => {
  const file = event.target.files[0]; if (!file) return; if (file.size > 2e6) throw Error('Pick a file under 2 MB.');
  const data = validateArchive(JSON.parse(await file.text())); if (!confirm('Replace your archive with this file?')) return;
  archive = await archiveRepository.save(data); sources = flatten(archive); renderEditor(); resetPlan(); status('Imported'); event.target.value = '';
});
$('delete').onclick = guard(async () => { if (!confirm('Delete the archive saved in this browser?')) return; await archiveRepository.clear(); archive = await archiveRepository.load(); sources = []; renderEditor(); resetPlan(); $('results').replaceChildren(); status('Archive deleted'); });
// ---- AI 판단 설정 -----------------------------------------------------------
async function renderAI(){
  const s=await loadSettings();
  $('ai-provider').replaceChildren(...Object.entries(PROVIDERS).map(([k,p])=>new Option(p.label,k)));
  $('ai-provider').value=s.provider;$('ai-base').value=s.base;$('ai-model').value=s.model;$('ai-key').value=s.apiKey;$('ai-enabled').checked=s.enabled;
  $('ai-state').textContent=isReady(s)?'On · '+s.model:s.enabled?'Not set up':'Off';
}
function readAI(){return {enabled:$('ai-enabled').checked,provider:$('ai-provider').value,base:$('ai-base').value,model:$('ai-model').value,apiKey:$('ai-key').value};}
$('ai-provider').onchange=()=>{const p=PROVIDERS[$('ai-provider').value];$('ai-base').value=p.base;$('ai-model').value=p.model;};
$('ai-save').onclick=()=>{
  let draft;
  try{draft=readAI();originPattern(draft.base);}catch{status('Check the API URL.');return;}
  // Ask for the endpoint's host permission inside the click so Chrome shows the prompt.
  const request=draft.enabled?chrome.permissions.request({origins:[originPattern(draft.base)]}):Promise.resolve(true);
  request.then(async granted=>{
    if(!granted)throw Error('Access to the AI service was not granted.');
    await saveSettings(draft);await renderAI();
    status(draft.enabled?'Saved. Try "Test connection".':'AI off. Rules only.');
  }).catch(error=>status(error.message));
};
$('ai-test').onclick=guard(async()=>{
  const s=await loadSettings();
  if(!isReady(s))throw Error('Turn AI on and save a model and key first.');
  status('Testing… (a local model may take 30 s to load)');
  const started=Date.now();
  parseJSON(await complete(s,'JSON 객체 하나만 출력하세요.','{"질문":"연결 확인입니다. {\\"ok\\":true} 를 출력하세요."}',{maxTokens:50}));
  // A small real task, so the user sees whether this model is good enough for form judgment.
  const sample=await pickCandidate({query:'동탄국제고등학교',label:'학교명',candidates:['동탄고등학교','동탄국제고등학교(경기 화성시)','동탄중학교']},s).catch(()=>({index:-1}));
  const secs=((Date.now()-started)/1000).toFixed(1);
  status(sample.index===1?'Connected · '+s.model+' · test passed ('+secs+' s)':'Connected, but the test question failed · '+s.model+' ('+secs+' s). AI answers will be suggestions only.');
});
renderAI();
renderEditor();
