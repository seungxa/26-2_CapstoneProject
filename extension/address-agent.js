(() => {
  if(globalThis.__jobseekerAddressV1)return;globalThis.__jobseekerAddressV1=true;
  const V=globalThis.JobSeekerValues;
  const W=globalThis.JobSeekerWidgets;
  const visible=el=>el?.isConnected&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
  const text=el=>(el.innerText||el.textContent||el.value||'').trim().replace(/\s+/g,' ');
  const notice=(message,warn=false)=>chrome.runtime.sendMessage({type:'JS_NOTICE',message,warn}).catch(()=>{});
  let active=null,cleanup=null;
  // "Not in this list": the form tries the licence in its next table, so this popup is closed.
  const reportNone=async(intent,message)=>{
    await chrome.runtime.sendMessage({type:'JS_SEARCH_DONE',created:intent.created,ok:false,noResult:true,message}).catch(()=>{});
    if(window.opener)setTimeout(()=>window.close(),300);
  };
  // Tell the form which result was taken when it was the closest one rather than an exact fit.
  const reportPick=(intent,picked,score,others=[])=>chrome.runtime.sendMessage({type:'JS_SEARCH_DONE',created:intent.created,ok:true,review:true,picked,score,others,
    message:'"'+intent.query+'" → "'+picked+'" picked (match '+Math.round(score*100)+'%) · please check'}).catch(()=>{});
  async function incruitAddress(intent,state){
    const value=id=>document.getElementById(id)?.value||'';
    const matches=(road,zip)=>V.addressMatches(road,intent.query)&&(!intent.postcode||zip===intent.postcode);
    const detail=document.getElementById('txtAddrDet');
    const apply=document.getElementById('btnOk2');
    if(visible(detail)&&visible(apply)){
      if(!state.review&&!matches(value('txtRoadAddr'),value('txtZip')) || detail.value && detail.value!==intent.detail && !(state.defaultDetail && V.norm(detail.value)===V.norm(state.defaultDetail))){
        state.finished=true;
        notice('The address in the popup differs from your archive. Check it.',true);
        return true;
      }
      if(intent.detail && detail.value!==intent.detail){
        detail.value=intent.detail;
        detail.dispatchEvent(new Event('input',{bubbles:true}));
      }
      state.finished=true;
      if(state.review)await reportPick(intent,state.review.picked,state.review.score,state.review.others);
      apply.click();
      return true;
    }
    const rows=[...document.querySelectorAll('#divRoadArea .load_lay tr')].filter(row=>visible(row)&&row.querySelector('[id="newRoadAddr"]'));
    if(rows.length){
      const found=rows.filter(row=>matches(row.querySelector('[id="newRoadAddr"]').value,row.querySelector('[id="newZip"]')?.value));
      if(found.length===1 && !state.selected){
        state.defaultDetail=found[0].querySelector('[id="newRoadAddrDet"]')?.value;
        state.selected=true;
        found[0].click();
      }else if(!state.selected){
        // Several or no exact rows: the highest score (road + building number, postcode) is taken for review.
        const ranked=rows.map((row,index)=>{const road=row.querySelector('[id="newRoadAddr"]').value,zip=row.querySelector('[id="newZip"]')?.value||'';
          return {row,index,name:road,score:V.addressScore(road+' '+zip,intent.query,intent.postcode)};}).sort((a,b)=>b.score-a.score||a.index-b.index);
        if(ranked[0]&&ranked[0].score>=V.AUTO_PICK('address')){
          state.review={picked:ranked[0].name,score:ranked[0].score,others:ranked.slice(1,4).map(r=>r.name)};
          state.defaultDetail=ranked[0].row.querySelector('[id="newRoadAddrDet"]')?.value;
          state.selected=true;
          ranked[0].row.click();
        }
      }
      return true;
    }
    return state.selected;
  }
  async function assist(intent,child,state) {
    if(child && (intent.topic||'address')==='address' && /(^|\.)incruit\.com$/i.test(location.hostname) &&
      /^\/_lc\/popup\/popup_roadsearch\.asp$/i.test(location.pathname) && await incruitAddress(intent,state))return true;
    if(child && intent.topic==='credential' && /(^|\.)incruit\.com$/i.test(location.hostname) &&
       /^\/_lc\/popup\/popup_searchlicensecd\.asp$/i.test(location.pathname)){
      const query=document.querySelector('#frmSearch #Sch_Nm');
      const button=document.querySelector('#frmSearch button[type=button]');
      if(!visible(query)||!visible(button)||text(button)!=='검색')return false;
      if(state.searched && query.value!==intent.query){state.finished=true;return false;}
      if(!state.searched){
        if(query.value && query.value!==intent.query)return false;
        query.value=intent.query;
        state.searched=true;
        button.click();
        return true;
      }
      const index=new URL(location.href).searchParams.get('elemid');
      if(intent.index!=null && String(intent.index)!==index)return false;
      const found=[...document.querySelectorAll('#divSearchList td.s_tle[onclick]')].filter(cell=>{
        const args=/^fnConfirm\('([^']*)','([^']*)','(\d+)'\);?$/.exec(cell.getAttribute('onclick').trim());
        return args && args[3]===index && visible(cell) && text(cell)===intent.query &&
          args[1]===intent.query && (!intent.issuer || intent.issuer===args[2]);
      });
      if(found.length===1){state.finished=true;found[0].click();return true;}
      state.searchedAt??=Date.now();
      const cells=[...document.querySelectorAll('#divSearchList td.s_tle[onclick]')].map(cell=>({cell,args:/^fnConfirm\('([^']*)','([^']*)','(\d+)'\);?$/.exec(cell.getAttribute('onclick').trim())}))
        .filter(({cell,args})=>args&&args[3]===index&&visible(cell));
      if(!cells.length){
        // Results come in by script; wait a little, then treat an empty list as "not in this table".
        const listText=text(document.querySelector('#divSearchList')||document.body);
        if(/없습니다|없음|0\s*건|no result/i.test(listText)&&document.querySelector('#divSearchList')||Date.now()-state.searchedAt>4000){
          state.finished=true;await reportNone(intent,'"'+intent.query+'": no results');return true;
        }
        setTimeout(()=>document.documentElement.classList.toggle('jobseeker-wait'),700);
        return false;
      }
      const ranked=cells.map(({cell,args},i)=>({cell,i,name:args[1],score:Math.min(0.99,V.score(args[1],intent.query,'credential')+(intent.issuer&&args[2]===intent.issuer?0.05:0))})).sort((a,b)=>b.score-a.score||a.i-b.i);
      if(ranked[0].score<V.AUTO_PICK('credential')){state.finished=true;await reportNone(intent,'"'+intent.query+'": no close match ('+ranked.slice(0,3).map(r=>r.name).join(', ')+')');return true;}
      state.finished=true;
      await reportPick(intent,ranked[0].name,ranked[0].score,ranked.slice(1,4).map(r=>r.name));
      ranked[0].cell.click();
      return true;
    }
    const dialogs=[...document.querySelectorAll('dialog,[role=dialog]')].filter(visible);
    const root=dialogs[0]||(child?document.body:null);
    const topic=intent.topic||'address';
    const vocabulary={address:/주소|우편|postal|address/i,school:/학교/,major:/전공|학과/,credential:/자격증/}[topic];
    if(!root||!vocabulary?.test(text(root).slice(0,16000)+' '+document.title))return false;
    const queries=[...root.querySelectorAll('input[type=text],input[type=search],input:not([type])')].filter(el=>visible(el)&&!el.readOnly&&!el.disabled).slice(0,12);
    let searchTerm=intent.query;
    if(topic==='major'){
      const hints=[text(root),...queries.map(el=>el.placeholder||'')].join(' ');
      for(const pair of hints.matchAll(/([가-힣A-Za-z0-9]+)\s*(?:-+>|→|⇒)\s*([가-힣A-Za-z0-9]+)/g)){
        if(intent.query.replace(/학과$/,'학')===pair[1].replace(/학과$/,'학') && pair[1].startsWith(pair[2])){
          searchTerm=pair[2];break;
        }
      }
      if(searchTerm===intent.query && /두\s*글자|2\s*글자|전기전자공학\s*(?:-+>|→)\s*전기/.test(hints))searchTerm=Array.from(intent.query).slice(0,2).join('');
    }
    const initialValues=new Map(queries.map(el=>[el,el.value]));
    const searches=[...root.querySelectorAll('button,input[type=button],input[type=submit],a,[role=button]')].filter(el=>visible(el)&&/^(검색|주소검색|우편번호검색|학교검색|전공검색|학과검색|자격증검색|search|찾기)$/i.test(V.norm(text(el))));
    const popupUrl=new URL(location.href);
    const incruitMajor=child && topic==='major' && /(^|\.)incruit\.com$/i.test(popupUrl.hostname) &&
      /^\/_lc\/popup\/popup_searchschool\.asp$/i.test(popupUrl.pathname) && popupUrl.searchParams.get('maincd')==='Major';
    if(incruitMajor && (!intent.fieldId || popupUrl.searchParams.get('elemid')!==intent.fieldId))return false;
    const resultSelector=incruitMajor?'#divSearchList td.s_tle[onclick]':'a,button,[role=option],[data-address]';
    const matching=[...root.querySelectorAll(resultSelector)].filter(el=>!incruitMajor||
      /^fnConfirm\('([^']*)'\);?$/.exec(el.getAttribute('onclick').trim())?.[1]===intent.query).filter(el=>visible(el)&&(topic==='address'?V.addressMatches(text(el),intent.query):V.norm(text(el))===V.norm(intent.query))&&!/다음|제출|저장|확인|동의|결제/.test(text(el))).slice(0,30);
    const nodes=new Map();const items=[];
    for(const [kind,list]of [['query',queries],['search',searches],['result',matching]])list.forEach((el,i)=>{const id=`${kind}${i}`;nodes.set(id,el);items.push({id,kind,label:el.getAttribute('aria-label')||el.getAttribute('placeholder')||text(el).slice(0,250)});});
    if(active!==state||state.finished)return false;
    const semanticQueries=queries.filter(el=>/주소|도로명|건물번호|검색어|address|keyword|query/i.test([el.getAttribute('aria-label'),el.getAttribute('placeholder'),el.name,el.id].join(' '))&&!/상세|detail/i.test([el.getAttribute('placeholder'),el.name,el.id].join(' ')));
    const queryNode=queries.length===1?queries[0]:semanticQueries.length===1?semanticQueries[0]:null;
    const sameFormSearches=queryNode?.form?searches.filter(el=>el.form===queryNode.form):[];
    const searchNode=searches.length===1?searches[0]:sameFormSearches.length===1?sameFormSearches[0]:null;
    const plan={queryControlId:queryNode?`query${queries.indexOf(queryNode)}`:'',searchControlId:searchNode?`search${searches.indexOf(searchNode)}`:'',resultControlId:matching.length===1?'result0':''};
    const result=nodes.get(plan.resultControlId);
    if(state.searched&&state.queryNode&&state.queryNode.value!==state.searchTerm){state.finished=true;notice('You changed the search — stopped.',true);return false;}
    if(result&&matching.includes(result)&&active?.searched){
      if(result.matches('button,input')&&result.type==='submit'||result.closest('a[href]:not([href="#"])')||/submit|location|nextstep/i.test(result.getAttribute('onclick')||''))return false;
      result.click();active.finished=true;notice('Picked the matching result.');return true;
    }
    const query=nodes.get(plan.queryControlId),search=nodes.get(plan.searchControlId);
    if(active?.searched||!queries.includes(query)||!searches.includes(search))return false;
    if(search.matches('button,input')&&search.type==='submit'||search.closest('a[href]:not([href="#"])')||/submit|location|nextstep/i.test(search.getAttribute('onclick')||'') &&
      !(incruitMajor && search.matches('button[type=button]') && text(search)==='검색' && search.getAttribute('onclick')==='frmSubmit()'))return false;
    if(query.value!==initialValues.get(query)||query.value&&query.value!==searchTerm){state.finished=true;notice('The search box already had text — stopped.',true);return false;}
    // This capability exists only in a popup/dialog connected to a user-selected
    // address field. It never offers a generic click command or application next.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(query,searchTerm);
    query.dispatchEvent(new Event('input',{bubbles:true}));query.dispatchEvent(new Event('change',{bubbles:true}));
    active.searched=true;state.searchTerm=searchTerm;state.queryNode=query;search.click();notice('Searching…');return true;
  }
  // Only Incruit's address and licence popups keep their dedicated handlers; school/major popups use the generic search.
  const incruitPopup=()=>/(^|\.)incruit\.com$/i.test(location.hostname)&&/^\/_lc\/popup\/popup_(roadsearch|searchlicensecd)\.asp$/i.test(location.pathname);
  // Search terms: the popup's own example ("전기전자공학 → 전기") decides the form first.
  function termsFor(intent,root){
    const base=[...(Array.isArray(intent.terms)?intent.terms:[]),...V.variants(intent.query,intent.topic)];
    const hints=[text(root).slice(0,4000),...[...root.querySelectorAll('input')].map(el=>el.placeholder||'')].join(' ');
    const pairs=[...hints.matchAll(/([가-힣A-Za-z0-9]+)\s*(?:-+>|→|⇒|=>)\s*([가-힣A-Za-z0-9]+)/g)].filter(p=>p[1].startsWith(p[2])&&p[1].length>p[2].length);
    const first=[];
    for(const pair of pairs)if(V.core(intent.query.replace(/학과$/,'학'))===V.core(pair[1].replace(/학과$/,'학')))first.push(pair[2]);
    const lengths=new Set(pairs.map(p=>Array.from(p[2]).length));
    if(lengths.size===1){const n=[...lengths][0];const stem=V.stem(intent.query).stem||intent.query;if(Array.from(stem).length>n)first.push(Array.from(stem).slice(0,n).join(''));}
    if(/두\s*글자|2\s*글자/.test(hints))first.push(Array.from(intent.query).slice(0,2).join(''));
    return [...new Set([...first,...base])].filter(t=>Array.from(t).length>=2).slice(0,6);
  }
  function startGeneric(intent,child){
    // A popup that names its target field (…?elemid=UniversityName) must be the one this request opened.
    const target=new URL(location.href).searchParams.get('elemid');
    if(child&&target&&!/^\d+$/.test(target)&&intent.fieldId&&target!==intent.fieldId)return;
    const state={searched:false,finished:false,created:intent.created,query:intent.query};active=state;
    const before=child?null:W.layerSnapshot();
    const field=intent.fieldId?document.getElementById(intent.fieldId):null;
    const topic=intent.topic||'generic';
    cleanup=()=>{state.finished=true;};
    (async()=>{
      let root=null;
      const started=Date.now();
      for(const end=started+20000;!root&&Date.now()<end&&active===state;){
        // A site may reuse one search layer; after a moment any open layer without the field qualifies.
        root=child?(W.popupRoot(null,null)||(W.searchInput(document.body,topic)?document.body:null)):W.popupRoot(Date.now()-started>1500?null:before,field);
        if(root&&!W.searchInput(root,topic))root=null;
        if(!root)await W.sleep(250);
      }
      if(!root||active!==state)return;
      const result=await W.searchAndPick(root,{terms:termsFor(intent,root),query:intent.query,topic,label:intent.label,field,detail:intent.issuer,extras:intent.extras,
        pick:args=>chrome.runtime.sendMessage({type:'JS_LLM_PICK',...args}),isCancelled:()=>active!==state});
      if(active!==state)return;
      state.finished=true;
      if(!result.ok&&topic==='credential'&&child){await reportNone(intent,result.message);notice(intent.label+': "'+intent.query+'" not in this list — trying the next one.');return;}
      chrome.runtime.sendMessage({type:'JS_SEARCH_DONE',created:intent.created,ok:result.ok,message:result.message,review:Boolean(result.review),picked:result.picked,score:result.review?.score,others:result.review?.others}).catch(()=>{});
      notice(result.ok?result.message+(result.how==='llm'?' (AI)':''):result.message+' Pick it in the popup.',!result.ok);
    })().catch(error=>notice(error.message,true));
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(sender.id!==chrome.runtime.id||message.type!=='JS_ADDRESS_CONTEXT')return;
    if(!message.intent?.query||String(message.intent.query).length>300){respond({error:'Invalid search request'});return;}
    if(active?.created===message.intent.created && active?.query===message.intent.query)return;
    if(cleanup)cleanup();
    if((message.intent.topic||'address')!=='address' && !incruitPopup()){startGeneric(message.intent,message.child===true);respond({ok:true});return;}
    const state={searched:false,finished:false,created:message.intent.created,query:message.intent.query};active=state;let running=false,tries=0;
    const tick=async()=>{if(running||active!==state||state.finished||tries++>30)return;running=true;try{await assist(message.intent,message.child===true,state);}catch(error){notice(error.message,true);}finally{running=false;}};
    const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(tick,250);});let timer;
    observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','class','style','aria-hidden']});tick();
    const deadline=setTimeout(()=>{observer.disconnect();if(active===state&&!state.finished){state.finished=true;notice('Could not pick one address. Pick it in the popup.',true);}},30000);
    cleanup=()=>{observer.disconnect();clearTimeout(timer);clearTimeout(deadline);state.finished=true;};
    respond({ok:true});
  });
})();
