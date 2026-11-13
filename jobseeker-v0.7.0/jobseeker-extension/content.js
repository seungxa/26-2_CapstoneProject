(() => {
  if (globalThis.__jobseekerApplyV1) return;
  globalThis.__jobseekerApplyV1 = true;
  if (/(^|\.)incruit\.com$/i.test(location.hostname) && /\/_lc\/popup\/popup_(?:roadsearch|searchlicensecd|searchlicenseN)\.asp$/i.test(location.pathname)) return;
  const tokens = new Map();
  let selected = null, busy = false, lastPointer = 0;
  const V = globalThis.JobSeekerValues;
  const W = globalThis.JobSeekerWidgets;
  const pendingAddress=new WeakSet();
  const searchDone=new Map();
  let lastEntries=new Map(),lastMissed=[];
  let lastNotice = 0;
  let serial = 0;
  let stage = null;
  const documentId=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const norm = value => String(value ?? '').toLowerCase().replace(/[\s_\-:：*()（）/\.]/g, '');
  const text = el => (el?.innerText || el?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  const visible = el => !!el?.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert]');
  const enabled = el => !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  const byId = (el,id) => el.getRootNode?.().getElementById?.(id) || document.getElementById(id);
  // Styled forms hide the real radio/checkbox or select and show a label or a custom box instead.
  const proxyLabel = el => [...(el.labels||[])].find(visible) || null;
  const shown = el => visible(el) || (el?.matches?.('input[type=radio],input[type=checkbox]') && Boolean(proxyLabel(el))) || (el?.tagName==='SELECT' && Boolean(W.proxyFor(el)));
  const DROPDOWN_CLASS = /(^|[\s_-])(select|selectbox|select-box|dropdown|drop-down|combo|combobox|picker)([\s_-]|$)/i;
  function dropdownTrigger(el){
    if(!el?.matches || el.matches('input:not([readonly]),select,textarea,li,option,[role=option],ul,ol,table,tr,td,form,body') || !visible(el))return false;
    if(el.parentElement?.closest('button,[role=button]'))return false;
    const cls=el.className?.baseVal ?? el.className ?? '';
    const popup=el.getAttribute('aria-haspopup');
    // "계급을 선택해주세요 ▾" drawn with plain divs: a clickable box whose only text is a selection prompt.
    const prompt=/^(.{1,12}(을|를)\s*)?선택(해\s*주세요|하세요|해주십시오|하십시오)?\.?$/.test(text(el))&&(el.matches('button,[role=button]')||getComputedStyle(el).cursor==='pointer');
    if(prompt&&el.parentElement&&text(el.parentElement)===text(el)&&getComputedStyle(el.parentElement).cursor==='pointer'&&!el.parentElement.querySelector('input:not([readonly]):not([type=hidden]),select,textarea'))return false;
    if(!(popup && popup!=='false' && popup!=='dialog') && !DROPDOWN_CLASS.test(cls) && !prompt)return false;
    if(el.closest('[role=listbox],[role=menu],nav,header,footer'))return false;
    if(el.querySelector('input:not([readonly]):not([type=hidden]),select,textarea,button,a[href]:not([href="#"])') && !el.matches('button'))return false;
    const t=text(el);
    if(t.length>40||/검색|찾기|조회|추가|삭제|저장|다음|이전|확인|등록|업로드|첨부|인증|제출|닫기|취소/.test(t))return false;
    if(el.matches('button,a,input[type=button]')&&!(popup&&popup!=='false')&&!prompt&&!(V.PLACEHOLDER.test(V.core(t))||/^-*선택/.test(V.core(t))||!t))return false;
    // Hidden native selects are filled directly; their visible mirror is not a second field.
    for(let n=el,i=0;n&&i<3;n=n.parentElement,i++){if([n.previousElementSibling,n.nextElementSibling,n.parentElement?.querySelector(':scope > select')].some(x=>x?.tagName==='SELECT'&&!visible(x)))return false;}
    // Use the outermost trigger only.
    for(let up=el.parentElement,i=0;up&&i<3;up=up.parentElement,i++){
      const c=up.className?.baseVal ?? up.className ?? '';
      if(visible(up)&&text(up).length<=40&&(DROPDOWN_CLASS.test(c)||up.getAttribute('aria-haspopup')==='listbox')&&!up.querySelector('input:not([readonly]):not([type=hidden]),select,textarea'))return false;
    }
    return true;
  }
  const prohibited = /제출|최종확인|지원완료|접수|결제|동의|개인정보|약관|탈퇴|삭제|로그아웃|submit|applynow|payment|consent|delete/i;
  function label(el) {
    const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => text(byId(el,id))).join(' ');
    const explicit = el.labels?.length ? [...el.labels].map(l => {
      const copy = l.cloneNode(true); copy.querySelectorAll('input,select,textarea,button').forEach(c => c.remove()); return text(copy);
    }).join(' ') : '';
    const cell = el.closest('td');
    const row = cell?.parentElement;
    const previous = cell?.previousElementSibling;
    // Legacy recruitment forms often use th/td instead of HTML labels.
    const tableLabel = previous?.matches('th,[role=rowheader]') ? text(previous) :
      previous?.matches('td') && !previous.querySelector('input,select,textarea,button') && text(previous).length <= 40 ? text(previous) :
      row?.querySelector('th[scope=row]') ? text(row.querySelector('th[scope=row]')) : '';
    let nearby = tableLabel && tableLabel !== '@' ? tableLabel : '';
    if (!nearby) {
      for (let parent = el.parentElement, depth = 0; parent && depth < 6; parent = parent.parentElement, depth++) {
        if (parent.matches('tr')) {
          const heading = [...parent.children].find(child => child.matches('th,[role=rowheader]'));
          if (heading) { nearby = text(heading); break; }
        }
        if (parent.matches('dd') && parent.previousElementSibling?.matches('dt')) { nearby = text(parent.previousElementSibling); break; }
      }
    }
    const ph=(el.getAttribute('placeholder')||'').trim();
    const asked=(ph||(!el.matches('input,textarea,select')?text(el):'')).match(/^(.{1,12}?)\s*(을|를)\s*(선택|입력)(해\s*주세요|하세요|해주십시오|하십시오)\.?$/);
    const placeholderName=ph&&Array.from(ph).length<=8&&!/예\)|예:|ex|입력|선택|해\s*주세요|하세요|[0-9@.]/i.test(ph)?ph:'';
    return el.getAttribute('aria-label') || labelled || explicit || nearby || placeholderName || asked?.[1] || rowLabel(el) || el.getAttribute('placeholder') || el.getAttribute('title') || el.name || el.id || '';
  }
  // Div-grid layouts: <div class="row"><div class="tit">학교명</div><div><input></div></div>
  // deep: a question made of several buttons/radios, whose caption may sit above a box that also holds follow-up fields.
  function rowLabel(el,deep=false){
    const ownText=node=>{let t='';for(const c of node.childNodes)if(c.nodeType===3)t+=c.textContent;return t.trim();};
    for(let prev=el.previousSibling;prev;prev=prev.previousSibling){
      if(prev.nodeType===3){const t=prev.textContent.trim().replace(/[:：]$/,'');if(t&&t.length<=20&&/[가-힣A-Za-z]{2}/.test(t))return t;if(t)break;continue;}
      if(prev.nodeType!==1)continue;
      if(prev.matches('input,select,textarea,button,br'))break;
      const t=text(prev).replace(/[:：]$/,'');if(t&&t.length<=20&&!prev.querySelector('input,select,textarea'))return t;break;
    }
    for(let node=el.parentElement,depth=0;node&&depth<(deep?7:5)&&!node.matches('form,body,table,fieldset');node=node.parentElement,depth++){
      for(let prev=node.previousElementSibling;prev;prev=prev.previousElementSibling){
        if(prev.matches('script,style,template'))continue;
        if(prev.querySelector('input:not([type=hidden]),select,textarea,[role=combobox],button')||prev.matches('input,select,textarea,button'))break;
        const t=(text(prev)||ownText(prev)).replace(/^[*\s]+|[*\s:：]+$/g,'');
        if(t&&t.length<=24)return t;
        if(t)break;
      }
      if(!deep && node.parentElement && [...node.parentElement.children].filter(c=>c.querySelector?.('input:not([type=hidden]),select,textarea')).length>1)break;
    }
    return '';
  }
  // Format guidance near the box: printed suffix ("[    ] 고등학교"), help lines, examples.
  function hintsFor(el,root){
    let suffix='';
    for(let next=el.nextSibling;next;next=next.nextSibling){
      if(next.nodeType===3){const t=next.textContent.trim();if(t){suffix=t;break;}continue;}
      if(next.nodeType!==1)continue;
      if(next.matches('input,select,textarea,button,br'))break;
      const t=text(next);if(t&&t.length<=12&&!next.querySelector('input,select,textarea,button')){suffix=t;}break;
    }
    const help=[];
    const described=(el.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean).map(id=>text(byId(el,id)));
    help.push(...described);
    const scope=el.closest('tr')||root||el.parentElement;
    const row=scope?.parentElement;
    for(const box of [scope,row?.nextElementSibling?.matches?.('tr')?row.nextElementSibling:null].filter(Boolean)){
      for(const node of box.querySelectorAll('p,small,span,em,div,li,.help,.guide,.desc,.info,.txt')){
        const t=text(node);
        if(t&&t.length<=200&&!node.querySelector('input,select,textarea')&&/예\s*[):]|예시|ex\)|e\.g|※|제외|빼고|생략|까지만|만\s*입력|약칭|형식|→|->|최대|이내/i.test(t))help.push(t);
      }
    }
    return {suffix:suffix.slice(0,20),help:[...new Set(help)].join(' / ').slice(0,300),placeholder:el.getAttribute('placeholder')||'',title:el.getAttribute('title')||''};
  }
  function splitEmail(el) {
    // A shared label plus an @ separator or a domain list identifies a single address.
    for(let scope=el.parentElement;scope && !scope.matches('form,body,table');scope=scope.parentElement){
      const nodes=[...scope.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(shown);
      const boxes=nodes.filter(n=>n.matches('input')&&['text','email'].includes(n.type));
      const lists=nodes.filter(n=>n.matches('select'));
      if(boxes.length>2 || lists.length>1 || boxes.length+lists.length!==nodes.length)break;
      const [list]=lists;
      const hasDomains=list && [...list.options].some(o=>/^[\w.-]+\.[a-z]{2,}$/i.test(text(o).replace(/^@/,''))||/^[\w.-]+\.[a-z]{2,}$/i.test(o.value));
      if((boxes.length===2 && scope.textContent.includes('@') || boxes.length>=1 && hasDomains) && nodes.includes(el)){
        const fieldNames=[semanticLabel(rootFor(boxes[0]),boxes[0]),label(boxes[0]),text(scope.querySelector('legend')),text(scope.previousElementSibling?.matches('label,dt,th')?scope.previousElementSibling:null)];
        if(fieldNames.some(n=>/^(?:이메일|전자우편|email)(?:주소|address)?(?:확인|재확인|재입력)?$/.test(norm(n)))){
          // "직접입력" often reveals a domain box that is hidden until chosen.
          const hiddenBox=boxes.length===1?[...scope.querySelectorAll('input[type=text],input:not([type])')].find(n=>n!==boxes[0]&&!shown(n)):null;
          return {local:boxes[0],domain:boxes[1]||hiddenBox||null,list};
        }
      }
      if(scope.matches('tr,fieldset'))break;
    }
    return null;
  }
  function section(el) {
    const container = el.closest('fieldset,[role=dialog],section,article');
    return text(container?.querySelector('legend,h1,h2,h3,[role=heading]'));
  }


  // jQuery UI / flatpickr date boxes are read-only for typing but accept a set value.
  const datepicker=el=>el?.matches?.('input')&&el.readOnly&&/hasDatepicker|datepicker|flatpickr|date-?picker|calendar/i.test((el.className||'')+' '+(el.getAttribute('data-provide')||''));
  const STATUS_BOX=/^(재직|재직중|현재재직중|졸업예정|재학중|재학|휴학중|졸업|해당없음|비대상|해당사항없음)$/;
  function mirrorOfHiddenSelect(el){
    for(let n=el,i=0;n&&i<4;n=n.parentElement,i++)
      for(const sel of [n.previousElementSibling,n.nextElementSibling,n.parentElement?.querySelector(':scope > select')])
        if(sel?.tagName==='SELECT'&&!visible(sel)&&W.proxyFor(sel)?.contains(el))return sel;
    return null;
  }
  // "주소입력" whose boxes are locked until the search fills them.
  function addressStarter(el){
    return Boolean(el?.matches?.('button,[role=button],a')&&/^(주소검색|주소입력|주소등록|주소찾기|우편번호검색|우편번호찾기|도로명주소검색)$/.test(btnText(el))&&
      [...rootFor(el).querySelectorAll('input')].some(i=>!shown(i)||i.disabled||i.readOnly));
  }
  function supported(el) {
    if(!el?.matches || !enabled(el))return false;
    if(el.tagName!=='SELECT'&&!el.matches('input[type=radio],input[type=checkbox]')&&mirrorOfHiddenSelect(el))return false;
    if(el.matches('input[type=radio]'))return shown(el);
    if(el.matches('input[type=checkbox]'))return shown(el) && STATUS_BOX.test(norm(optionLabel(el)||label(el)));
    if(el.tagName==='SELECT')return shown(el);
    if(!visible(el))return false;
    if(el.matches('textarea,[role=combobox],[role=radio],button[type=button][aria-pressed]'))return true;
    if(el.tagName==='INPUT')return ['text','email','tel','number','url','search','date','month',''].includes(el.type) || !el.hasAttribute('type');
    if(W.toggleGroup(el))return true;
    if(addressStarter(el))return true;
    return dropdownTrigger(el);
  }
  function optionLabel(el) {
    if(el.type==='checkbox')return el.labels?.length?[...el.labels].map(text).join(' '):el.getAttribute('aria-label')||'';
    if(el.type==='radio') {
      const linked=el.labels?.length?[...el.labels].map(text).join(' '):'';
      const named=el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>text(document.getElementById(id))).join(' ').trim() || linked;
      if(named)return named;
      const adjacent=(radio,side)=>{
        let node=radio[side];
        while(node && !node.textContent?.trim() && node.nodeType!==1)node=node[side];
        return node?.matches?.('input,button,select')||node?.matches?.('label')&&node.querySelector('input')?'':node?.textContent?.trim()||'';
      };
      const group=radioNodes(el);
      for(const side of ['nextSibling','previousSibling']){
        const values=group.map(r=>V.gender(adjacent(r,side)));
        if(values.includes('male') && values.includes('female') && new Set(values).size===group.length)
          return adjacent(el,side);
      }
      return adjacent(el,'nextSibling') || el.value;
    }
    return text(el);
  }
  // The top element inside a shadow root has no parentElement: fall back to its host, then itself.
  function rootFor(el) {return el.closest('td') || el.closest('[role=radiogroup],[role=group],[data-field],.form-group,.form-item,.field') || el.closest('label') || el.parentElement || el.getRootNode?.().host || el;}
  function semanticLabel(root, el) {
    const previous=root?.previousElementSibling;
    const hint=[el.getAttribute('aria-label'),el.getAttribute('placeholder'),el.previousSibling?.textContent,el.name,el.id].join(' ');
    if(/성명|이름|name/i.test(text(previous)||label(el))){
      if(/한자|hanja|chinese/i.test(hint))return '한자성명';
      if(/영문|english|nameen\b|engname/i.test(hint))return '영문성명';
    }
    if(previous?.matches('th,dt') || previous?.matches('td,label') && !previous.querySelector('input,textarea,select,button') && root.matches('td,[role=radiogroup],[role=group]')) return text(previous);
    if(el.type==='radio'||el.matches('[role=radio],button[aria-pressed]')||W.toggleGroup(el)){
      const group=el.closest('[role=group],[role=radiogroup],fieldset');
      const named=group&&(group.getAttribute('aria-label') || text(byId(el,group.getAttribute('aria-labelledby'))) || text(group.querySelector('legend')));
      if(named)return named;
      if(W.toggleGroup(el)){const g=W.toggleGroup(el);let holder=el.parentElement;while(holder&&!g.every(b=>holder.contains(b)))holder=holder.parentElement;return rowLabel(holder||el.parentElement,true)||rowLabel(el);}
    }
    if(el.type==='radio'){
      // Options sit next to each other with their own labels; the question is the row's label.
      const own=text(el.closest('[role=radiogroup]')?.querySelector('legend'))||text(el.closest('fieldset')?.querySelector('legend'));
      // Start above the box that holds every option of the group ("남" and "여" each wrapped separately).
      const group=radioNodes(el);let holder=group[0]?.parentElement||el.parentElement;
      while(holder&&holder!==document.body&&!group.every(r=>holder.contains(r)))holder=holder.parentElement;
      const row=rowLabel(holder&&holder!==document.body?holder:el.parentElement,true);
      if(!own&&row&&!radioNodes(el).some(r=>V.core(optionLabel(r))===V.core(row)))return row;
    }
    return el.getAttribute('aria-label') || text(el.closest('[role=radiogroup]')?.querySelector('legend')) || (el.type==='radio'?text(el.closest('fieldset')?.querySelector('legend')):'') || label(el);
  }
 function radioNodes(el){
    const byName=radioByName(el);
    if(byName.length>1)return byName;
    // name="남" / name="여": the options are the radios sharing the nearest box that holds only them.
    for(let box=el.parentElement,i=0;box&&i<4&&box!==document.body;box=box.parentElement,i++){
      const radios=[...box.querySelectorAll('input[type=radio]')].filter(r=>shown(r)&&enabled(r));
      if(radios.length>1)return box.querySelectorAll('input:not([type=radio]):not([type=hidden]),select,textarea').length?byName:radios;
    }
    return byName;
  }
  function radioByName(el) {return [...(el.getRootNode().querySelectorAll?.('input[type=radio]')||document.querySelectorAll('input[type=radio]'))].filter(r=>r.name===el.name&&(el.name || rootFor(r)===rootFor(el))&&r.form===el.form&&shown(r)&&enabled(r));}
  function controlsFor(el,root,base) {
    if(el.type==='checkbox')return [{el,kind:'checkbox'}];
    if(el.matches('button[type=button][aria-pressed]')){
      const group=el.closest('[role=group],[role=radiogroup],fieldset,td');
      const radios=group?[...group.querySelectorAll('button[type=button][aria-pressed]')].filter(node=>visible(node)&&enabled(node)):[];
      return [{el,radios,kind:'radio'}];
    }
    if(el.type==='radio') return [{el,radios:radioNodes(el),kind:'radio'}];
    if(el.matches('[role=radio]')) return [{el,radios:[...(el.closest('[role=radiogroup]')||root).querySelectorAll('[role=radio]')].filter(visible),kind:'radio'}];
    if(el.matches('[role=combobox]')) return [{el,kind:'custom'}];
    const toggles=W.toggleGroup(el);
    if(toggles) return [{el,radios:toggles,kind:'radio'}];
    if(!el.matches('input,select,textarea')) return [{el,kind:'custom'}];
    const nodes=[...root.querySelectorAll('input,select,textarea')].filter(n=>supported(n)&&n.type!=='radio'&&n.type!=='checkbox'&&!n.readOnly);
    // Selects that name themselves ("주|야간", "소재지") are separate questions, not one split value.
    const selfNamed=n=>n.tagName==='SELECT'&&n.options[0]&&!n.options[0].value&&!V.PLACEHOLDER.test(V.core(text(n.options[0])));
    if(el.tagName==='SELECT'&&selfNamed(el))return [{el,kind:'select'}];
    const compact=nodes.every(n=>n.tagName==='SELECT'&&!selfNamed(n)||n.maxLength>0&&n.maxLength<=4);
    if((/휴대|전화|연락처|생년|출생|birthday|birthdate|dateofbirth/i.test(base)||compact)&&nodes.length>=2&&nodes.length<=3) return nodes.map(el=>({el,kind:el.tagName==='SELECT'?'select':el.type||'text'}));
    return [{el,kind:el.tagName==='SELECT'?'select':el.type||'text'}];
  }
  function controlValue(control) {
    if(control.kind==='checkbox')return control.el.checked?(optionLabel(control.el)||label(control.el)):'';
    if(control.radios) return control.radios.filter(W.isOn).map(optionLabel).join(',');
    if(control.kind==='select'){const option=control.el.selectedOptions[0];if(!control.el.value||/^(선택|선택하세요|선택해주세요|select|choose|selectanoption)$/i.test(V.norm(text(option))))return '';}
    if(control.kind==='custom'){const value=control.el.matches('input,textarea')?control.el.value:text(control.el);return V.PLACEHOLDER.test(V.core(value).replace(/[▼▾⌄∨]/g,''))||/^-*선택-*$/.test(V.core(value))||/선택(해\s*주세요|하세요|해주십시오|하십시오)\.?$/.test(value.trim())?'':value;}
    return control.el.value ?? text(control.el);
  }
  function optionsFor(control) {
    if(control.radios) return control.radios.map((r,i)=>({id:String(i),label:r.matches('input')?optionLabel(r):text(r),value:r.value||r.getAttribute('data-value')||''}));
    if(control.el.tagName==='SELECT') return [...control.el.options].filter(o=>!o.disabled).map((o,i)=>({id:String(i),label:text(o),value:o.value}));
    return [];
  }
  // Resolve visual columns even when a school tier or language spans several rows.
  function tableContext(el) {
    const cell=el.closest('td,th'), table=cell?.closest('table');
    if(!table)return {anchors:[],column:''};
    const grid=[];
    let rowIndex, colIndex;
    for(const [i,row] of [...table.rows].entries()){
      grid[i] ||= [];
      let j=0;
      for(const item of row.cells){
        while(grid[i][j])j++;
        if(item===cell){rowIndex=i;colIndex=j;}
        for(let y=i;y<i+Math.min(item.rowSpan||1,100);y++){
          grid[y] ||= [];
          for(let x=j;x<j+Math.min(item.colSpan,60);x++)grid[y][x]=item;
        }
        j+=item.colSpan;
      }
      if(rowIndex!==undefined)break;
    }
    const plain=item=>item && !item.querySelector('input:not([type=hidden]),select,textarea,button,table') ? text(item).replace(/^[*\s]+/,'') : '';
    const anchors=[...new Set((grid[rowIndex]||[]).map(plain).filter(Boolean))];
    const selectedValues=[...(cell?.parentElement?.querySelectorAll('select')||[])].filter(s=>s!==el&&s.value).map(s=>text(s.selectedOptions[0]));
    let column='';
    for(let i=(rowIndex??0)-1;i>=0;i--){
      const upper=grid[i]?.[colIndex], header=plain(upper);
      if(upper?.colSpan===1 && !upper.parentElement.querySelector('input,select,textarea') && /^(언어|시험명|점수|등급|등록번호|수험번호|취득일|발행처|자격증명?|자격증)$/.test(header)){column=header;break;}
      // A grid ("학력 | 학교명 | 전공 | 재학기간 …" over rows 고등학교/대학교): the column header names the field.
      const headerRow=upper?.parentElement;
      if(upper?.colSpan===1 && header && header.length<=12 && headerRow && !headerRow.querySelector('input:not([type=hidden]),select,textarea') &&
         [...headerRow.cells].length>=3 && [...headerRow.cells].every(c=>plain(c)||!text(c))){column=header;break;}
      if(upper && upper.parentElement?.querySelector('input:not([type=hidden]),select,textarea'))continue;
    }
    return {column,leading:plain(grid[rowIndex]?.[0]),anchors:[...anchors,...selectedValues]};
  }
  function nearbyHeading(el){
    for(let current=el;current && current!==document.body;current=current.parentElement){
      for(let prev=current.previousElementSibling;prev;prev=prev.previousElementSibling){
        if(prev.matches('h1,h2,h3,h4,legend,caption,[role=heading]'))return text(prev);
        if(prev.matches('table,section,form'))break;
      }
    }
    return '';
  }
  // "비대상/해당없음" picked in the same row: its number boxes (보훈번호, 장애 등록번호) are not asked for.
  const OFF_CHOICE=/^(비대상|해당없음|해당사항없음|미해당|비해당|없음|무)$/;
  function gatedOff(el){
    if(!el?.matches?.('input:not([type=radio]):not([type=checkbox]),textarea'))return false;
    const row=el.closest('tr')||rootFor(el);if(!row)return false;
    const after=r=>{let n=r.nextSibling;while(n&&n.nodeType===3&&!n.textContent.trim())n=n.nextSibling;return n?.nodeType===3?n.textContent.trim().split(/\s/)[0]:'';};
    for(const r of row.querySelectorAll('input[type=radio]:checked'))if(OFF_CHOICE.test(norm(optionLabel(r)))||OFF_CHOICE.test(norm(after(r))))return true;
    for(const s of row.querySelectorAll('select'))if(s!==el&&s.value!==''&&OFF_CHOICE.test(norm(text(s.selectedOptions[0]))))return true;
    return false;
  }
  // Boxes the site keeps locked (filled by its own popup, or unlocked only for 대상) are not the user's to type.
  // A button in the row (TOEIC "인증") means the user still has something to do there, so it stays listed.
  const rowAction=el=>[...(el.closest('tr')||rootFor(el)||document.createElement('i')).querySelectorAll('button,input[type=button],input[type=image]')].some(b=>visible(b)&&enabled(b)&&!/ui-datepicker-trigger/.test(b.className)&&!/^(삭제|초기화|지우기|reset|delete)$/i.test(btnText(b))&&!/reset|delete|init/i.test(b.getAttribute('onclick')||''));
  const locked=el=>Boolean(el?.matches?.('input')&&el.readOnly&&!el.getAttribute('onclick')&&!datepicker(el)&&!dropdownTrigger(el)&&getComputedStyle(el).cursor!=='pointer'&&!rowAction(el));
  // 병역사항: women usually leave it blank (or pick 해당없음), so it is never a to-do for them.
  const militaryQuestion=el=>{try{return /병역|군필|복무/.test([section(el),nearbyHeading(el),label(el)].join(' '));}catch{return false;}};
  function pageFemale(){
    return [...document.querySelectorAll('input[type=radio]:checked')].some(r=>{
      const group=[r.name,r.id,label(r)].join(' ');
      if(!/성별|sex|gender/i.test(group))return false;
      return /^(여|여성|여자|female|f|w)$/i.test(norm(optionLabel(r)))||/^(여|여성|f|female|w|2)$/i.test(String(r.value).trim());
    });
  }
  // The popup took the closest result, not an exact one: hand it to the panel's review list.
  function reviewOf(created,shownValue){
    const done=created!=null&&searchDone.get(created);
    return done?.ok&&done.review?{picked:shownValue||done.picked,score:done.score,others:done.others||[],message:done.message}:null;
  }
  function descriptor(entry) {
    const {el,root,controls,base,token}=entry;
    const emailParts=entry.email?controls.map(c=>c.el===entry.email.local?'local':'domain'):null;
    const tableInfo=tableContext(el);
    const heading=section(el)||nearbyHeading(el);
    const anchors=[...tableInfo.anchors,heading];
    const schoolLabels=[tableInfo.leading];
    for(let parent=el.closest('table')?.parentElement?.closest('td,th');parent;parent=parent.closest('table')?.parentElement?.closest('td,th')){
      schoolLabels.push(tableContext(parent).leading);
    }
    schoolLabels.push(text(el.closest('table')?.caption),heading);
    let metaLabel=entry.email?'이메일':base||tableInfo.column;
    if(entry.catalog?.topic==='credential')metaLabel='자격증명';
    if(el.id==='UniversityMajor' && entry.catalog?.topic==='major')metaLabel='전공';
    // "[부 ▾] [검색]": the second major box is the minor or double major chosen in the select before it.
    if(entry.catalog?.topic==='major'&&/minor|double|sub/i.test((el.name||'')+' '+(el.id||''))){
      const kind=[...(el.parentElement?.querySelectorAll('select')||[])].find(s=>s.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING);
      metaLabel=/복수/.test(kind?text(kind.selectedOptions[0]):'')?'복수전공':'부전공';
    }
    const licenseRow=el.closest('tr')?.querySelector('input[name="License"]');
    if(licenseRow && el.form?.name==='applyform' && /(^|\.)incruit\.com$/i.test(location.hostname)){
      if(licenseRow.value)anchors.push(licenseRow.value);
      anchors.push('자격증');
      if(el.name==='LicenseNumber')metaLabel='등록번호';
      if(el.name==='LicenseOrg')metaLabel='발행처';
    }
    if(el.tagName==='TEXTAREA' && /^intro\d*$/i.test(base)){
      const prompt=root.closest('tr')?.previousElementSibling;
      if(prompt && !prompt.querySelector('textarea,input,select') && /작성|기술|서술|설명/.test(text(prompt)))metaLabel=text(prompt);
    }
    const headings=[document.title,...[...document.querySelectorAll('h1,h2,h3,[role=heading]')].map(text)];
    const repeated=stage && [...document.querySelectorAll('input,textarea,select')].some(other=>
      other!==el && !controls.some(c=>c.el===other||c.radios?.includes(other)) && visible(other) &&
      semanticLabel(rootFor(other),other)===base);
    const hints=controls.length===1&&el.matches('input,textarea')?{...hintsFor(el,root),label:metaLabel}:undefined;
    return {token,hints,schoolLabels,datePart:entry.datePart,needsVerifiedAddress:Boolean(stage && (addressButton(root)||stage.hasLookup) && !stage.verified.has(root) && !stage.addressDone),label:metaLabel,name:el.name,id:el.id,section:heading,context:[heading,...anchors].join(' '),anchors,headings,repeated:entry.catalog?.index!=null?[...el.form.elements].filter(n=>n.name===el.name).length>1:repeated,gatedOff:gatedOff(el),military:militaryQuestion(el),autocomplete:(el.autocomplete||'').split(/\s+/).at(-1),catalog:entry.catalog?.topic,kind:entry.addressButton?'address':controls[0].kind,emailParts,
      value:controls.map(controlValue).join(' / '), controls:controls.map((c,i)=>({id:`c${i}`,kind:c.kind,label:label(c.el),name:c.el.name||c.el.id||'',placeholder:c.el.getAttribute('placeholder')||'',maxLength:c.el.maxLength||-1,value:controlValue(c),options:optionsFor(c)}))};
  }
  function searchLayerInput(el){
    for(let n=el.parentElement;n&&n!==document.body;n=n.parentElement){
      if(getComputedStyle(n).position!=='fixed')continue;
      return W.searchInput(n)===el&&Boolean(W.searchButton(n,el));
    }
    return false;
  }
  // Image buttons (<a><img alt="학교검색"></a>, <input type=image>) are named by alt/title.
  const btnText=b=>norm((text(b)||b.value||b.alt||b.title||b.getAttribute?.('aria-label')||[...b.querySelectorAll('img')].map(i=>i.alt||i.title).join('')||'').replace(/[▸▶>›]/g,''));
  function addressButton(root) {
    if(!root?.querySelectorAll)return null;
    const named=b=>/^(주소검색|주소입력|주소등록|주소찾기|주소찾기하기|우편번호검색|우편번호찾기|도로명주소검색|검색|찾기)$/.test(btnText(b))&&visible(b)&&enabled(b);
    // Also a clickable text box ("우편번호 찾기" in a <span>) when no real button carries the name.
    return [...root.querySelectorAll('button,input[type=button],input[type=image],a,[role=button]')].find(named)||
      [...root.querySelectorAll('span,div,label,p')].find(b=>!b.children.length&&getComputedStyle(b).cursor==='pointer'&&named(b))||null;
  }
  function catalogButton(root, el, base){
    if(!el.matches('input[type=text],input:not([type])'))return null;
    if(/(^|\.)incruit\.com$/i.test(location.hostname) && el.form?.name==='applyform' && /^License(N)?$/.test(el.name)){
      const targets=[...root.querySelectorAll('button,input[type=button],a,img,[onclick]')].filter(b=>
        visible(b) && enabled(b) && /license|자격증|검색/i.test([b.getAttribute('onclick'),b.title,b.alt,text(b),b.type==='button'?b.value:''].join(' ')));
      const button=targets.find(b=>b!==el)|| (el.readOnly?el:null);
      if(button)return {button,topic:'credential',index:[...el.form.elements].filter(n=>n.name===el.name).indexOf(el)};
    }
    if(/(^|\.)incruit\.com$/i.test(location.hostname) && el.id==='UniversityMajor' && el.readOnly){
      const trigger=[...root.querySelectorAll('button[type=button],input[type=button]')].find(b=>visible(b)&&/전공검색/.test(norm(text(b)||b.value)));
      return {button:trigger||el,topic:'major'};
    }
    const known={학교:'school',학교명:'school',대학교명:'school',출신학교:'school',고등학교명:'school',전공:'major',전공명:'major',학과:'major',학과명:'major',주전공:'major',부전공:'major',복수전공:'major',자격증:'credential',자격증명:'credential',자격명:'credential'}[norm(base)];
    if(/주소|우편/.test(base))return null;
    const topic=known||(el.readOnly?'generic':null);
    if(!topic)return null;
    const scope=[root,root.parentElement].find(r=>r&&r.querySelectorAll('input[type=text],input:not([type])').length===1&&[...r.querySelectorAll('button,input[type=button],a,[role=button],img[onclick]')].some(visible))||root;
    const buttons=[...scope.querySelectorAll('button,input[type=button],input[type=image],a,[role=button],img[onclick]')].filter(b=>!(b.matches('img')&&b.closest('a,button'))).filter(b=>visible(b)&&enabled(b)&&
      /^(학교|전공|학과|자격증|기관)?(검색|찾기|조회|선택)$/.test(btnText(b)));
    const inputs=[...scope.querySelectorAll('input[type=text],input:not([type])')].filter(visible);
    if(buttons.length===1&&inputs.length===1)return {button:buttons[0],topic};
    // Several boxes in one cell: the search button that follows this box (before the next box) is its own.
    if(buttons.length&&inputs.length>1){
      const after=n=>el.compareDocumentPosition(n)&Node.DOCUMENT_POSITION_FOLLOWING;
      const nextBox=inputs.find(i=>i!==el&&after(i));
      const own=buttons.filter(b=>after(b)&&(!nextBox||b.compareDocumentPosition(nextBox)&Node.DOCUMENT_POSITION_FOLLOWING));
      if(own.length===1)return {button:own[0],topic};
    }
    // A read-only box that opens the search itself.
    if(el.readOnly && known && (el.getAttribute('onclick')||/search|popup|layer|find/i.test(el.className)))return {button:el,topic};
    return null;
  }
  function buildEntry(el) {
    if(!supported(el))return null;
    const root=rootFor(el);let base=semanticLabel(root,el);
    const gridColumn=tableContext(el).column;
    if(gridColumn)base=gridColumn;
    if(el.matches('input:not([type=radio]):not([type=checkbox])')&&root.querySelectorAll('input:not([type=hidden]),select,textarea').length>1){
      let prev=el.previousSibling;while(prev&&prev.nodeType===3&&!prev.textContent.trim())prev=prev.previousSibling;
      // Only an explicit caption counts: "[보훈번호]", "평점:", or a <label>/<b> tag — not "월 입학 ~".
      const raw=(prev?.nodeType===3?prev.textContent:prev?.matches?.('label,span,b,strong,em')&&!prev.querySelector('input,select')?text(prev):'').trim();
      const tagged=prev?.nodeType===1, caption=/^[\[(].+[\])]$/.test(raw)||/[:：]$/.test(raw);
      const inline=raw.replace(/^[\[(]|[\])]$|[:：]$/g,'').trim();
      if((tagged||caption)&&Array.from(inline).length>=2&&Array.from(inline).length<=12&&!/[~\-@]|^\d|[년월일]\s*$/.test(inline))base=inline;
    }
    // "소재지", "고교계열선택", "만점선택": the empty first choice names the select.
    if(el.tagName==='SELECT'&&el.options[0]&&!el.options[0].value){
      const named=text(el.options[0]).replace(/\s*(선택|을 선택|를 선택)\s*$/,'').trim();
      if(named&&!V.PLACEHOLDER.test(V.core(named))&&!/^-+$/.test(named))base=named;
    }
    if(el.tagName==='SELECT'&&[...el.options].filter(o=>o.value).every(o=>/^(부|복수|부전공|복수전공)$/.test(V.core(text(o)))))return null;
    // A country-code select (+82, +1 …) keeps its default: Korean numbers are typed in the box beside it.
    if(el.tagName==='SELECT'&&el.options.length>1&&[...el.options].filter(o=>text(o)).every(o=>/^\+?\d{1,4}(\s|\(|$)|^\+\d/.test(text(o).trim())||/국가|country/i.test(text(o))))return null;
    let datePart='';
    if(/기간/.test(base) && el.tagName==='SELECT'){
      const labels=[...el.options].map(o=>V.core(text(o)));
      // "입학/편입" keeps the site default; "재학/졸업…" is the graduation status; "재직/퇴사" the job status.
      if(labels.every(l=>/^(입학|편입|선택|)$/.test(l)))return null;
      if(labels.some(l=>/^(졸업|재학|졸업예정|졸업\(예\)|졸업예)$/.test(l)))base='졸업구분';
      else if(labels.some(l=>/^(재직|재직중|퇴사|퇴직)$/.test(l)))base='재직구분';
    }
    if(/기간/.test(base)){
      const range=document.createRange();range.selectNodeContents(root);range.setEndBefore(el);
      if(/[~～〜]/.test(root.textContent)){
        const end=/[~～〜]/.test(range.toString());
        const context=[section(el),nearbyHeading(el),...tableContext(el).anchors,base].join(' ');
        if(/병역|복무|군필/.test(context))base=end?'복무종료일':'복무시작일';
        else if(/경력|근무/.test(context))base=end?'퇴사일':'입사일';
        else if(/학교|학력|대학|입학|졸업|편입/.test(context+' '+text(root)))base=end?'졸업일':'입학일';
        const unit=(el.nextSibling?.textContent||'').trim().match(/^([년월일])/);
        if(unit)datePart=unit[1];
      }
    }
    if(prohibited.test(base)||/주민등록|여권번호/.test(base))return null;
    // A select sitting next to a school/major search box (계열, 부/복수) is a different question.
    if(el.tagName==='SELECT'&&/학교|전공|학과/.test(base)&&[...root.querySelectorAll('input[readonly]')].some(i=>i!==el&&catalogButton(rootFor(i),i,base))){
      const opts=[...el.options].map(o=>V.core(text(o)));
      if(opts.some(o=>/^(공학|인문|상경|자연|사범|예체능)$/.test(o)))base='계열';else return null;
    }
    let button=/주소|우편/.test(base)?addressButton(root):null;
    // Locked address boxes: the "주소입력" button itself is the field.
    if(el.matches('button,[role=button],a')&&!dropdownTrigger(el)&&/주소|우편/.test(btnText(el))){button=el;base='주소';}
    const addressInputs=[...root.querySelectorAll('input[type=text],input:not([type])')];
    if(button&&!el.readOnly&&(/detail|addr_?2|address_?2|상세/i.test([el.name,el.id,el.getAttribute('placeholder')].join(' '))||addressInputs.length>=3&&el===addressInputs.at(-1))){base='상세주소';button=null;}
    const email=el.matches('input,select')?splitEmail(el):null;
    if(email)base='이메일';
    const catalog=catalogButton(root,el,tableContext(el).column||base);
    let customTrigger=false;
    if(el.readOnly&&!button&&!catalog&&!datepicker(el)){
      if(!(dropdownTrigger(el)||el.closest('[aria-haspopup]:not([aria-haspopup=false])')))return null;
      customTrigger=true;
    }
    return {el,root,base,datePart,catalog,email,token:`${documentId}:${++serial}`,controls:customTrigger?[{el,kind:'custom'}]:email?[email.local,email.list,email.domain].filter(Boolean).map(el=>({el,kind:el.tagName==='SELECT'?'select':el.type})):datePart?[{el,kind:el.tagName==='SELECT'?'select':el.type}]:controlsFor(el,root,base),addressButton:button};
  }
  function choose(el, pointer=false) {
    if (stage && !stage.review && Date.now()-stage.lastUse>60000) stage=null;
    if (stage) return;
    if(selected?.el===el&&Date.now()-lastNotice<200)return;
    let entry=null;
    try{entry=buildEntry(el);}catch(error){console.warn('JobSeeker: could not read the field',error);}
    if(!entry){clearSelection();return;}
    if(entry.addressButton && !pointer)return;
    tokens.clear();selected=entry;tokens.set(entry.token,entry);lastNotice=Date.now();
    chrome.runtime.sendMessage({type:'JS_TARGET',field:descriptor(selected)}).catch(()=>{});
  }
  function clearSelection(){tokens.clear();selected=null;chrome.runtime.sendMessage({type:'JS_TARGET',field:null}).catch(()=>{});}
  document.addEventListener('pointerdown',event=>{
    if(!event.isTrusted)return;
    if(stage && !stage.review && Date.now()-stage.lastUse>60000)stage=null;
    // While the panel shows suggestions to confirm, clicking around the page to check them is fine.
    if(stage){if(!stage.review)stage.cancelled=true;return;}
    lastPointer=Date.now();
    const target=event.target instanceof Element?event.target:null;
    const action=target?.closest('button,a,input[type=button],[role=button]');
    if(action && action===addressButton(rootFor(action)))return;
    let el=target?.closest('input,textarea,select,[role=combobox],[role=radio],button[type=button][aria-pressed]')||target?.closest('label')?.control;
    if(el&&!supported(el))el=null;
    for(let up=target,i=0;!el&&up&&i<4;up=up.parentElement,i++)if(supported(up)&&!up.matches('td,th,tr,form,body'))el=up;
    for(let up=target,i=0;up&&i<4&&(!el||!el.matches('input,select,textarea'));up=up.parentElement,i++){
      const sel=[up.previousElementSibling,up.nextElementSibling,up.parentElement?.querySelector(':scope > select')].find(x=>x?.tagName==='SELECT'&&W.proxyFor(x)?.contains(target));
      if(sel){el=sel;break;}
    }
    if(!el){let region=target?.closest('td,th,[role=radiogroup]');if(region?.tagName==='TH')region=region.nextElementSibling;el=[...(region?.querySelectorAll('input,select,textarea,[role=combobox],[role=radio],button[type=button][aria-pressed]')||[])].find(supported);}
    whenIdle(()=>choose(el,true));
  },true);
  // Keyboard (Tab) focus selects too; a mouse click already queued its own selection.
  // Focus moved by our own filling (reported as trusted by the browser) is not the user picking a field.
  document.addEventListener('focusin',event=>{if(event.isTrusted&&!stage&&!busy&&Date.now()-(W.lastSynthetic||0)>800&&Date.now()-lastPointer>500&&supported(event.target))whenIdle(()=>choose(event.target));},true);
  // A click that lands while the previous field is still being filled is queued, not dropped.
  let idleWaiter=0;
  function whenIdle(fn){
    const ticket=++idleWaiter;
    const run=(tries=0)=>{if(ticket!==idleWaiter)return;if(busy&&tries<50)return setTimeout(()=>run(tries+1),100);if(!busy)fn();};
    setTimeout(run,0);
  }
  function checkedEntry(token,staged=false){
    const entry=staged&&stage?stage.entries.get(token):tokens.get(token);
    if(!entry||(!staged&&entry!==selected)||!shown(entry.el))throw Error('The field changed. Click it again.');
    return entry;
  }
  function events(el){el.dispatchEvent(new Event('input',{bubbles:true,composed:true}));el.dispatchEvent(new Event('change',{bubbles:true,composed:true}));W.commit(el);}
  // Rule match first; the AI layer (through the extension, never the page) only breaks ties.
  async function pickNode(nodes,desired,labelOf,fieldLabel,allowAI=true){
    const options=nodes.map(n=>({label:labelOf(n),value:n.value||n.getAttribute?.('data-value')||''}));
    const found=V.matchOption(options,desired);
    if(found?.index>=0)return nodes[found.index];
    if(!allowAI)return null;
    const pool=found?.ambiguous?.length?found.ambiguous:options.map((_,i)=>i).filter(i=>!V.PLACEHOLDER.test(V.core(options[i].label)));
    const reply=await chrome.runtime.sendMessage({type:'JS_LLM_PICK',query:desired,label:fieldLabel,candidates:pool.map(i=>options[i].label)}).catch(()=>null);
    return reply?.index>=0&&reply.index<pool.length?nodes[pool[reply.index]]:null;
  }
  function dangerousHandler(el){return ['oninput','onchange','onclick'].some(key=>/\.submit\s*\(|requestSubmit|location\s*[.=]|window\.open|(?:next|submit|save|confirm)(?:step|form|page)?\s*\(/i.test(el.getAttribute(key)||''));}
  const choiceLabel=n=>n.matches('input')?optionLabel(n):text(n);
  function clickSelection(el,entry) {
    if(!entry.controls.some(c=>c.el===el||c.radios?.includes(el))&&!el.matches('[role=option]'))throw Error('Outside the selected field.');
    if(W.navigates(el) || el.matches('button')&&el.type!=='button'||prohibited.test(text(el))||dangerousHandler(el))throw Error('Not clicked: it may submit or change the page.');
    // A hidden radio/checkbox is operated through its visible label.
    if(!visible(el)&&proxyLabel(el)){proxyLabel(el).click();return;}
    if(el.matches('input'))el.click();else W.click(el);
  }
  async function fillEmail(entry,value,expected,overwrite){
    const {local,domain,list}=entry.email;
    const user=V.transform(value,'emailLocal'), host=V.transform(value,'emailDomain').toLowerCase();
    const opts=list?[...list.options].filter(o=>!o.disabled):[];
    const isHost=o=>[o.value,text(o)].some(v=>v.trim().replace(/^@/,'').toLowerCase()===host);
    const exact=opts.filter(isHost);
    const custom=opts.filter(o=>/^(직접입력|직접작성|직접입력하기|기타|기타직접입력|other|custom|enterdomain|self|direct)$/.test(norm(text(o)))||/^(직접|self|direct|etc|99|9)$/i.test(o.value)&&/직접/.test(text(o)));
    const option=exact.length===1?exact[0]:!exact.length&&domain&&custom.length===1?custom[0]:null;
    if(list&&!option)throw Error(custom.length===1?'Saved email domain ('+host+') is not in the list and there is no custom box.':'Saved email domain ('+host+') is not in the list. Pick one yourself.');
    if(entry.controls.some((c,i)=>dangerousHandler(c.el)||controlValue(c)!==expected?.[i]))throw Error('The email field changed.');
    if(!overwrite && (local.value&&local.value!==user || domain?.value&&domain.value.toLowerCase()!==host ||
      list && list.selectedIndex>0 && list.value && list.selectedOptions[0]!==option))throw Error('Kept the existing email.');
    const canWrite=(el,v)=>visible(el)&&enabled(el)&&!el.readOnly&&(!el.maxLength||el.maxLength<0||el.maxLength>=v.length);
    const write=(el,v)=>{
      if(el.value===v)return;
      if(!canWrite(el,v) || stage?.cancelled)throw Error('Check the email field.');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);events(el);
    };
    if(!canWrite(local,user) || list && (!visible(list)||!enabled(list)))throw Error('Check the email field.');
    if(list && list.selectedOptions[0]!==option){list.selectedIndex=option.index;events(list);}
    // A domain box that stays hidden after choosing a listed domain is not part of the answer.
    if(domain && option && !custom.includes(option) && !shown(domain)) {}
    else if(domain && domain.value.toLowerCase()!==host){
      for(let i=0;i<30&&!canWrite(domain,host)&&domain.value.toLowerCase()!==host;i++)await new Promise(r=>setTimeout(r,100));
      if(domain.value.toLowerCase()!==host)write(domain,host);
    }
    write(local,user);
    await new Promise(r=>setTimeout(r,150));
    const ok=entry.controls.every(c=>visible(c.el)||c.el===domain) && local.value===user && (!domain||!shown(domain)&&!custom.includes(option)||domain.value.toLowerCase()===host) && (!list||list.selectedOptions[0]===option);
    return {ok,message:ok?'email filled':'Could not confirm the email.'};
  }
  async function fill({token,value,assignments,expectedValues,overwrite,stage:batch=false}) {
    const entry=checkedEntry(token,batch);
    if(!Array.isArray(assignments)||!assignments.length||assignments.length>entry.controls.length)throw Error('Invalid fill plan');
    if(entry.catalog)return {ok:false,message:'Use "Fill this step" for search fields.'};
    if(entry.addressButton)return {ok:false,message:'Addresses go through the address search.'};
    if(entry.email){
      busy=true;
      try{return await fillEmail(entry,value,expectedValues,overwrite);}
      finally{busy=false;if(!batch){tokens.clear();selected=null;}}
    }
    const fieldLabel=entry.base||label(entry.el);
    const seen=new Set(),steps=[];
    for(const a of assignments){
      const index=Number(a.controlId?.slice(1)),c=entry.controls[index];
      if(a.controlId!==`c${index}`||!c||seen.has(index))throw Error('Outside the selected field.');seen.add(index);
      if(!shown(c.el)||!enabled(c.el)||c.el.readOnly&&c.kind!=='custom'&&!datepicker(c.el)||dangerousHandler(c.el))throw Error('This field is locked or may change the page.');
      if(controlValue(c)!==expectedValues?.[index])throw Error('You changed it — kept your value.');
      let desired;
      if(a.transform==='literal'){
        desired=String(a.literal??'');
        if(!V.derivedFrom(desired,value))throw Error('Not filled: value is not from your archive.');
      }else if(a.transform==='option'){
        desired=String(a.literal??'');
        if(!['select','radio','custom'].includes(c.kind))throw Error('Not a choice field.');
      }else desired=V.transform(value,a.transform);
      const exactOnly=a.transform==='option';
      if(c.el.type==='date')V.birth(desired);
      if(c.el.type==='month'&&!/^\d{4}-\d{2}$/.test(desired))throw Error('Needs YYYY-MM.');
      if(c.el.maxLength>0&&Array.from(desired).length>c.el.maxLength)throw Error('Too long for the field ('+c.el.maxLength+' chars).');
      if(c.kind==='checkbox'){
        const boxLabel=optionLabel(c.el)||label(c.el);
        const want=V.matchOption([{label:boxLabel,value:''}],desired)?.index===0;
        const same=c.el.checked===want;
        if(!same&&c.el.checked&&!overwrite)throw Error('Kept the existing check.');
        steps.push({c,desired:want?boxLabel:'',option:null,same});continue;
      }
      let option=null;
      if(c.kind==='select'){
        const all=[...c.el.options].filter(o=>!o.disabled);
        option=all.find(o=>V.norm(text(o))===V.norm(desired)||o.value===desired);
        if(!option&&/^(birth|record)/.test(a.transform))option=all.find(o=>Number(text(o).replace(/[년월일]/g,''))===Number(desired));
        if(!option&&!exactOnly)option=await pickNode(all,desired,o=>text(o),fieldLabel);
        if(!option)throw Error('No matching option ('+desired+').');desired=option.value;
      }
      if(c.kind==='radio'){option=await pickNode(c.radios,desired,choiceLabel,fieldLabel,!exactOnly);if(!option)throw Error('Several options fit ('+desired+').');}
      const existing=controlValue(c);
      const same=c.kind==='select'?c.el.value===desired:c.kind==='radio'?W.isOn(option):c.kind==='custom'?V.core(existing)===V.core(desired)||V.similar(existing,desired):existing===desired;
      const defaultPrefix=c.kind==='select'&&entry.controls.length>1&&entry.controls.filter(other=>other!==c).every(other=>!controlValue(other))&&
        (c.el.selectedIndex===0||[...c.el.options].findIndex(o=>o.defaultSelected)===c.el.selectedIndex);
      if(existing&&!overwrite&&!same&&!defaultPrefix)throw Error('Kept the existing value.');
      steps.push({c,desired,option,same});
    }
    busy=true;
    const notes=[];
    try{
      for(const step of steps){
        const {c,desired,option,same}=step;
        if (stage?.cancelled || !shown(c.el) || !enabled(c.el)) throw Error('The field changed.');
        if(same)continue;
        if(c.kind==='checkbox'){clickSelection(c.el,entry);}
        else if(c.kind==='radio'){step.before=W.styleKey(option);clickSelection(option,entry);}
        else if(c.kind==='custom'){
          const result=await W.openAndChoose(c.el,desired,{label:fieldLabel,strict:false,pick:args=>chrome.runtime.sendMessage({type:'JS_LLM_PICK',...args})});
          if(stage?.cancelled)throw Error('Stopped: you interacted with the page.');
          if(!result.label)throw Error(result.message);
          step.chosen=result.label;notes.push(result.message);
        }else{
          const proto=c.el.tagName==='SELECT'?HTMLSelectElement.prototype:c.el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto,'value').set.call(c.el,desired);events(c.el);
          if(c.kind==='select'&&!visible(c.el)&&!await W.syncProxy(c.el,text(option)))notes.push('Check the dropdown on the page.');
        }
        const mark=c.kind==='select'&&!visible(c.el)?W.proxyFor(c.el):!visible(c.el)?proxyLabel(c.el):c.el;
        if(mark){mark.style.outline='2px solid #2a9469';setTimeout(()=>mark.style.outline='',1600);}
      }
      await new Promise(r=>setTimeout(r,150));
      const ok=steps.every(({c,desired,option,chosen,before})=>(c.el.isConnected)&&(c.kind==='radio'?W.isOn(option)||Boolean(before)&&W.styleKey(option)!==before||option.matches('input')&&option.checked:c.kind==='checkbox'?Boolean(c.el.checked)===Boolean(desired):c.kind==='custom'?Boolean(chosen)||V.similar(controlValue(c),desired):c.el.value===desired||/\d/.test(desired)&&c.el.value.replace(/\D/g,'')===desired.replace(/\D/g,''))&&(!c.el.validity||c.el.validity.valid||c.kind==='custom'));
      return {ok,message:ok?`${steps.length} field(s) filled${notes.length?' · '+notes.join(' · '):''}`:'Some values could not be confirmed. Check the page.'};
    }finally{busy=false;if(!batch){tokens.clear();selected=null;}}
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(sender.id!==chrome.runtime.id||message.type==='JS_ADDRESS_CONTEXT'||!message.type?.startsWith('JS_'))return;
    if(message.stage && (!stage || stage.id!==message.id || stage.cancelled || stage.url!==location.href)){respond({error:'The step changed.'});return;}
    (async()=>{
      switch(message.type){
        case 'JS_STAGE_COVERAGE':{
          // Everything a person would see as a question on screen that this run did not handle.
          if(!stage||stage.id!==message.id)return {missed:[]};
          const covered=stage.covered, missed=[];
          const seenRows=new Set();
          const consider=W.deepQueryAll(document,'input:not([type=hidden]):not([type=password]):not([type=file]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset]),select,textarea,[role=combobox],[role=radio],button[type=button],[role=button]');
          const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:n=>/선택(해\s*주세요|하세요|해주십시오)/.test(n.textContent)&&n.textContent.trim().length<=20?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});
          for(let n=walker.nextNode();n;n=walker.nextNode())if(n.parentElement)consider.push(n.parentElement);
          const skipMilitary=Boolean(message.female)||pageFemale();
          for(const el of consider){
            if(!covered.has(el)&&(gatedOff(el)||locked(el)||skipMilitary&&militaryQuestion(el)))continue;
            if(covered.has(el)||!visible(el)&&!shown(el)||el.disabled||el.closest('nav,header,footer,dialog,[role=dialog],[aria-modal=true]'))continue;
            if(el.matches('button,[role=button]')&&!W.toggleGroup(el))continue;
            if(el.matches('input[type=checkbox]')&&prohibited.test(optionLabel(el)+' '+label(el)))continue;
            if(searchLayerInput(el))continue;
            let name='';try{name=semanticLabel(rootFor(el),el)||label(el);}catch{name=label(el);}
            name=(name||el.getAttribute('placeholder')||text(el)||'Unnamed field').replace(/\s+/g,' ').slice(0,30);
            if(prohibited.test(name)||/비밀번호|password|인증번호|captcha/i.test(name))continue;
            const row=rootFor(el);if(seenRows.has(row))continue;seenRows.add(row);
            const kind=el.matches('select')?'dropdown':el.matches('input[type=radio],[role=radio]')||W.toggleGroup(el)?'choice':el.matches('textarea')?'long text':el.matches('input')?'text':'dropdown';
            const filled=el.matches('input,textarea')?Boolean(el.value):el.matches('select')?Boolean(el.value):false;
            if(filled&&!el.matches('select'))continue;
            stage.missed.push(el);missed.push({index:stage.missed.length-1,label:name,kind});
            if(missed.length>=40)break;
          }
          return {missed};
        }
        case 'JS_FOCUS_MISSED':{
          const el=(stage?.missed||lastMissed)[message.index];if(!el?.isConnected)throw Error('Field not found.');
          const mark=shown(el)&&!visible(el)?(W.proxyFor(el)||proxyLabel(el)||el):el;
          mark.scrollIntoView({block:'center',behavior:'smooth'});mark.style.outline='3px solid #e08a1e';setTimeout(()=>mark.style.outline='',3500);
          return {ok:true};
        }
        case 'JS_FOCUS_FIELD':{
          // Show where a field is: scroll and outline only, nothing is typed or clicked.
          const entry=stage?.entries.get(message.token)||lastEntries.get(message.token);
          const el=entry?.el;if(!el?.isConnected)throw Error('Field not found — the page may have changed.');
          const mark=shown(el)&&!visible(el)?(W.proxyFor(el)||proxyLabel(el)||el):el;
          mark.scrollIntoView({block:'center',behavior:'smooth'});
          mark.style.outline='3px solid #e08a1e';mark.style.outlineOffset='2px';setTimeout(()=>{mark.style.outline='';mark.style.outlineOffset='';},3500);
          return {ok:true};
        }
        case 'JS_SEARCH_DONE':searchDone.set(message.created,message);return {ok:true};
        case 'JS_REMOVE_ROW':{
          // Only a row this run added (empty) is removed, with the row's own delete button.
          const entry=stage?.entries.get(message.token);const row=entry?.el?.closest('tr');
          if(!row||[...row.querySelectorAll('input:not([type=hidden]),select,textarea')].some(el=>el.value&&el.tagName!=='SELECT'))return {ok:false};
          const del=[...row.querySelectorAll('button,input[type=button],input[type=image],img[onclick],a[onclick],a[href^="javascript"],[role=button]')]
            .filter(b=>visible(b)&&(/^(삭제|행삭제|delete|remove|x|-)$/i.test(V.core(btnText(b)||''))||/^\s*(?:javascript:)?\s*[\w$.]*(del|remove)[\w$.]*\s*\(/i.test(b.getAttribute('onclick')||'')));
          if(del.length!==1)return {ok:false};
          W.click(del[0]);await new Promise(resolve=>setTimeout(resolve,300));
          return {ok:!row.isConnected};
        }
        case 'JS_ADD_ROW':{
          // More stored records than rows (e.g. 3 licences, 2 licence boxes): press the table's own "추가/+" button.
          if(!stage||stage.id!==message.id||stage.cancelled)throw Error('The step changed.');
          const topicOf=el=>{try{return el.matches('input[type=text],input:not([type])')&&catalogButton(rootFor(el),el,tableContext(el).column||semanticLabel(rootFor(el),el))?.topic;}catch{return null;}};
          const boxes=W.deepQueryAll(document,'input').filter(el=>visible(el)&&topicOf(el)===message.topic);
          const headingOf=el=>{const t=el.closest('table');return t?(section(t)||nearbyHeading(t)):'';};
          const table=(message.section&&boxes.filter(el=>headingOf(el)===message.section).at(-1)||boxes.at(-1))?.closest('table');
          if(!table)return {ok:false,message:'No table to add a row to.'};
          // The button sits in the table (header cell) or just around it, before the next section heading.
          const near=[table];
          for(let n=table.previousElementSibling,i=0;n&&i<4&&!n.matches('h1,h2,h3,h4,table');n=n.previousElementSibling,i++)near.push(n);
          for(let n=table.nextElementSibling,i=0;n&&i<3&&!n.matches('h1,h2,h3,h4,table');n=n.nextElementSibling,i++)near.push(n);
          // Judge a handler by its function name: "RowDataAdd(…,'btDelete.gif',10)" is an add button.
          const fn=b=>(/^\s*(?:javascript:)?\s*([\w$.]+)\s*\(/i.exec(b.getAttribute('onclick')||b.getAttribute('href')||'')||[])[1]||'';
          const named=b=>{const t=V.core(btnText(b)||'');const handler=fn(b);
            return (/^(\+|추가|행추가|항목추가|추가하기|add|addrow|더하기)$/i.test(t)||/^\+/.test((b.textContent||b.value||'').trim())||/add/i.test(handler))&&!/del|remove|init|reset/i.test(handler)&&!/삭제|초기화|delete|remove/i.test(t);};
          const buttons=[...new Set(near.flatMap(n=>[n,...n.querySelectorAll('button,input[type=button],input[type=image],img[onclick],a[onclick],a[href^="javascript"],[role=button],span[onclick]')]))]
            .filter(b=>b.matches('button,input[type=button],input[type=image],img[onclick],a[onclick],a[href^="javascript"],[role=button],span[onclick]')&&visible(b)&&enabled(b)&&named(b)&&!W.navigates(b)&&!prohibited.test(btnText(b))&&!(b.matches('button,input')&&b.type==='submit'));
          if(buttons.length!==1)return {ok:false,message:buttons.length?'Several add buttons; none pressed.':'No add button found.'};
          const before=[...table.querySelectorAll('input')].filter(el=>topicOf(el)===message.topic).length;
          W.click(buttons[0]);
          for(let n=0;n<16;n++){
            await new Promise(resolve=>setTimeout(resolve,125));
            const now=[...table.querySelectorAll('input')].filter(el=>visible(el)&&topicOf(el)===message.topic);
            if(now.length>before)return {ok:true,section:nearbyHeading(table)||section(table)};
          }
          return {ok:false,message:'No new row appeared (row limit?).'};
        }
        case 'JS_STAGE_BEGIN':
          stage={id:message.id,lastUse:Date.now(),covered:new WeakSet(),missed:[],seen:new WeakSet(),addresses:new WeakSet(),verified:new WeakSet(),entries:new Map(),url:location.href,cancelled:false};
          return {ok:true};
        case 'JS_STAGE_REVIEW':if(stage?.id===message.id){stage.review=true;stage.lastUse=Date.now();}return {ok:true};
        case 'JS_STAGE_END':
          if(stage?.id===message.id){lastEntries=stage.entries;lastMissed=stage.missed;stage=null;selected=null;tokens.clear();}
          return {ok:true};
        case 'JS_STAGE_NEXT':{
          if(!stage || stage.id!==message.id || stage.cancelled || stage.url!==location.href) throw Error('Stopped: the step changed.');
          stage.lastUse=Date.now();
          // Finish ordinary fields before a popup can take focus. Keep address and detail in one pass.
          const candidates=W.deepQueryAll(document,'input,select,textarea,[role=radio],[role=combobox],button[type=button],[role=button],[aria-haspopup],[class*=select],[class*=Select],[class*=dropdown],[class*=Dropdown],[class*=combo]');
          // "계급을 선택해주세요" boxes: start from the prompt text and climb to its clickable box.
          const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:n=>/선택(해\s*주세요|하세요|해주십시오)/.test(n.textContent)&&n.textContent.trim().length<=20?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});
          for(let n=walker.nextNode();n;n=walker.nextNode()){
            for(let up=n.parentElement,i=0;up&&i<5;up=up.parentElement,i++)if(dropdownTrigger(up)){if(!candidates.includes(up))candidates.push(up);break;}
          }
          candidates.sort((a,b)=>a===b?0:a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
          for(const pass of ['ordinary','address'])for(const el of candidates){
            if(stage.seen.has(el)||el.closest('dialog,[role=dialog],[aria-modal=true],nav,header,footer,[role=search]')||el.type==='search')continue;
            if(!el.matches('input,select,textarea,[role=radio],[role=combobox],button[aria-pressed]')&&!W.toggleGroup(el)&&!dropdownTrigger(el)&&!addressStarter(el)){stage.seen.add(el);continue;}
            let entry=null;
            try{entry=buildEntry(el);}catch(error){stage.seen.add(el);console.warn('JobSeeker: skipped field',error);continue;}
            if(!entry)continue;
            if(searchLayerInput(el)){stage.seen.add(el);continue;}
            const isAddress=entry.addressButton || /상세주소|addressdetail/i.test(entry.base);
            if((pass==='address')!==Boolean(isAddress))continue;
            for(const c of entry.controls){stage.seen.add(c.el);stage.covered.add(c.el);for(const radio of c.radios||[]){stage.seen.add(radio);stage.covered.add(radio);}}
            if(entry.addressButton)stage.covered.add(entry.addressButton);
            if(entry.addressButton){
              if(stage.addresses.has(entry.root))continue;
              stage.addresses.add(entry.root);stage.hasLookup=true;
            }
            tokens.clear();selected=entry;tokens.set(entry.token,entry);stage.entries.set(entry.token,entry);
            try{return {field:descriptor(entry)};}catch(error){console.warn('JobSeeker: skipped field',error);continue;}
          }
          return {field:null};
        }
        case 'JS_SELECTED':return {field:selected?descriptor(selected):null,frames:document.querySelectorAll('iframe,frame').length,frameOrigins:[...document.querySelectorAll('iframe[src],frame[src]')].map(el=>{try{const url=new URL(el.getAttribute('src'),location.href);return /^https?:$/.test(url.protocol)?url.origin+'/*':null;}catch{return null;}}).filter(Boolean)};
        case 'JS_FILL':return fill(message);
        case 'JS_CATALOG_OPEN':{
          const entry=checkedEntry(message.token,true), catalog=entry.catalog;
          if(!catalog || catalog.topic!==message.topic || !message.stage)throw Error('The search field changed.');
          const {button}=catalog;
          const issuer=entry.el.closest('tr')?.querySelector(`input[name="${CSS.escape(entry.el.name+'Org')}"]`);
          const matches=()=>entry.el.isConnected && Boolean(entry.el.value) && (V.norm(entry.el.value)===V.norm(message.query)||V.similar(entry.el.value,message.query)||catalog.topic==='major'&&V.sameMajor(entry.el.value,message.query)) &&
            (!issuer||!message.issuer||V.norm(issuer.value)===V.norm(message.issuer));
          if(issuer?.value && message.issuer && V.norm(issuer.value)!==V.norm(message.issuer))throw Error('Kept: the existing issuer differs.');
          if(matches())return {ok:true};
          // "[부 ▾] [전공검색]": switch the kind first when the stored value is a double major.
          if(message.kind){
            const kindSelect=[...(entry.el.parentElement?.querySelectorAll('select')||[])].find(s=>s.compareDocumentPosition(entry.el)&Node.DOCUMENT_POSITION_FOLLOWING);
            const option=kindSelect&&[...kindSelect.options].find(o=>V.core(text(o))===V.core(message.kind));
            if(option&&kindSelect.value!==option.value){kindSelect.value=option.value;events(kindSelect);}
          }
          if(entry.el.value || !visible(button) || !enabled(button) || !entry.root.contains(button) ||
             button.matches('button,input')&&button.type==='submit'||W.navigates(button)||
             /submit|location|nextstep|saveform/i.test(button.getAttribute('onclick')||''))throw Error('Check the search button or the existing value.');
          const terms=[...new Set([...(Array.isArray(message.terms)?message.terms:[]),...V.variants(message.query,catalog.topic)])].filter(t=>typeof t==='string'&&t.length<=100).slice(0,6);
          const armed=await chrome.runtime.sendMessage({type:'JS_ADDRESS_ARM',topic:catalog.topic,query:message.query,terms,extras:message.extras,label:entry.base,issuer:message.issuer,index:catalog.index,fieldId:entry.el.id});
          if(!armed?.ok||stage?.cancelled)throw Error('Search stopped.');
          const clicked=Date.now();
          if(button===entry.el||button.matches('img,span,div'))W.click(button);else button.click();
          // Chrome blocks window.open from a click the extension makes. Then the user's own click
          // on the box opens it, and the armed search still fills the popup.
          let opened=false;
          for(let n=0;n<12&&!opened&&!matches();n++){
            await new Promise(resolve=>setTimeout(resolve,250));
            opened=Boolean((await chrome.runtime.sendMessage({type:'JS_CHILD_SINCE',since:clicked-200,created:armed.created,extend:n===11}).catch(()=>null))?.opened)||Boolean(searchDone.get(armed.created))||Boolean(document.querySelector('[role=dialog]:not([hidden]),dialog[open]'));
          }
          if(!opened&&!matches()){
            entry.el.style.outline='3px solid #e08a1e';entry.el.style.outlineOffset='2px';setTimeout(()=>{entry.el.style.outline='';entry.el.style.outlineOffset='';},6000);
            throw Error('Popup blocked. Click the highlighted field and "'+message.query+'" will be picked for you (within 3 min).');
          }
          for(let n=0;n<80 && !stage?.cancelled;n++){
            const review=reviewOf(armed.created,entry.el.value);
            if(review&&entry.el.value)return {ok:true,review};
            if(matches()){await new Promise(resolve=>setTimeout(resolve,700));const late=reviewOf(armed.created,entry.el.value);return late?{ok:true,review:late}:{ok:true};}
            const done=searchDone.get(armed.created);
            // Licence cascade: "not found here" is an answer, so the panel can try the next table.
            if(done&&!done.ok&&message.cascade)return {ok:false,notFound:true,message:done.message};
            if(done&&!done.ok)throw Error(done.message+' Pick it in the popup.');
            if(done?.ok&&n>20)break;
            await new Promise(resolve=>setTimeout(resolve,250));
          }
          throw Error('Could not confirm the search result on the page.');
        }
        case 'JS_ADDRESS_OPEN':{
          const entry=checkedEntry(message.token,Boolean(message.stage));if(!entry.addressButton)throw Error('No address search button here.');
          const button=entry.addressButton;
          const inputs=[...entry.root.querySelectorAll('input')].filter(el=>['text','tel','number'].includes(el.type)&&visible(el));
          const detail=inputs.find(el=>/detail|addr_?2|address_?2|상세/i.test([el.name,el.id,el.placeholder].join(' '))) || (inputs.length===3?inputs[2]:null);
          const fields=inputs.filter(el=>el!==detail);
          const reflected=()=>fields.some(el=>V.addressMatches(el.value,message.query))&&(!message.postcode||fields.some(el=>el.value.trim()===message.postcode));
          if(reflected() && !message.stage)return {ok:true,message:'Address already set.'};
          if(!message.stage && fields.some(el=>el.value.trim()))return {ok:false,message:'Kept the existing address.'};
          if(pendingAddress.has(entry.root))return {ok:false,message:'An address popup is already open.'};
          if(message.stage){
            if(reflected()){stage.verified.add(entry.root);stage.addressDone=true;return {ok:true};}
            if(!fields.length)throw Error('Could not find the address boxes.');
            if(fields.some(el=>el.value.trim()))throw Error('The address on the page differs from your archive.');
          }
          if(button.matches('button,input')&&button.type==='submit'||W.navigates(button)||/submit|location|nextstep|saveform/i.test(button.getAttribute('onclick')||''))throw Error('Unsure what the address button does; not pressed.');
          if(!entry.root.contains(entry.addressButton)||!visible(entry.addressButton)||addressButton(entry.root)!==entry.addressButton)throw Error('The address field changed.');
          pendingAddress.add(entry.root);
          try{
          const armed=await chrome.runtime.sendMessage({type:'JS_ADDRESS_ARM',query:message.query,postcode:message.postcode,detail:message.detail});if(armed?.error)throw Error(armed.error);
          if(dangerousHandler(entry.addressButton)&&!/주소|zip|post|addr/i.test(entry.addressButton.getAttribute('onclick')||''))throw Error('Unsure what the address button does; not pressed.');
          if(message.stage && (!stage || stage.cancelled))throw Error('Stopped.');
          entry.addressButton.click();
          if(message.stage){
            for(let n=0;n<120;n++){
              if(!stage||stage.cancelled||!entry.root.isConnected)break;
              const shownAddress=()=>fields.map(el=>el.value.trim()).filter(Boolean).join(' ');
              const review=reviewOf(armed?.created,shownAddress());
              if(review&&fields.some(el=>el.value.trim())){stage.verified.add(entry.root);stage.addressDone=true;return {ok:true,review};}
              if(reflected()){stage.verified.add(entry.root);stage.addressDone=true;return {ok:true};}
              await new Promise(resolve=>setTimeout(resolve,250));
            }
            throw Error('Could not confirm the address; detail address left empty.');
          }
          return {ok:true,message:'Opening the address search…'};
          }finally{
            if(message.stage) pendingAddress.delete(entry.root);
            else setTimeout(()=>pendingAddress.delete(entry.root),1500);
          }
        }
        case 'JS_ADDRESS_PREPARE':{
          const entry=checkedEntry(message.token);if(!entry.addressButton)throw Error('Not an address field.');
          const result=await chrome.runtime.sendMessage({type:'JS_ADDRESS_ARM',query:message.query});if(result?.error)throw Error(result.error);
          return {ok:true,message:'Connected to your address popup.'};
        }
        default:throw Error('Not allowed.');
      }
    })().then(respond).catch(error=>respond({error:error.message}));return true;
  });
})();
