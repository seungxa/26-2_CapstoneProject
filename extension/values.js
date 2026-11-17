(() => {
  const norm = v => String(v ?? '').trim().toLowerCase().replace(/[\s._():-]/g, '');
  // A stricter key used to compare names across sites: width, case, spaces and punctuation are ignored.
  const core = v => String(v ?? '').normalize('NFKC').toLowerCase().replace(/[\s.,:;·・()[\]{}<>'"`‘’“”/\\\-_*~!?|]/g, '');
  function phone(value) {
    let digits = String(value).replace(/\D/g, '');
    if (digits.startsWith('82')) digits = '0' + digits.slice(2);
    const match = digits.match(/^(02|0\d{2})(\d{3,4})(\d{4})$/);
    if (!match) throw Error('Check the phone number.');
    return match.slice(1);
  }
  function birth(value) {
    const match = String(value).match(/^(\d{4})(?:[-./](\d{1,2})[-./](\d{1,2})|(\d{2})(\d{2}))$/);
    if (!match) throw Error('Save the birth date as YYYY-MM-DD.');
    const parts=[match[1],match[2]||match[4],match[3]||match[5]].map((v,i)=>i?String(v).padStart(2,'0'):v);
    const [y,m,d] = parts.map(Number), date = new Date(Date.UTC(y,m-1,d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m-1 || date.getUTCDate() !== d) throw Error('Invalid birth date.');
    return parts;
  }
  function gender(value) {
    const v = norm(value);
    if (['남','남자','남성','male','m','男'].includes(v)) return 'male';
    if (['여','여자','여성','female','f','女'].includes(v)) return 'female';
    return v;
  }
  function addressMatches(candidate,query){
    const postalText=value=>String(value??'').normalize('NFKC').trim().replace(/^서울특별시(?=\s)/,'서울').replace(/^서울시(?=\s)/,'서울').replace(/^(부산|대구|인천|광주|대전|울산)광역시(?=\s)/,'$1').replace(/^경기도(?=\s)/,'경기').replace(/\s+/g,'').toLowerCase();
    const q=postalText(query),c=postalText(candidate);
    if(!q||!/[0-9]/.test(q))return false;
    for(let pos=c.indexOf(q);pos!==-1;pos=c.indexOf(q,pos+1)){
      if(/^\d/.test(q)&&/\d/.test(c[pos-1]||''))continue;
      if(/\d$/.test(q)&&/^[\d-]/.test(c.slice(pos+q.length)))continue;
      return true;
    }
    return false;
  }

  // ---- Name forms ---------------------------------------------------------
  // Each family lists interchangeable endings, longest first. "동탄국제고등학교",
  // "동탄국제고" and "동탄국제" are the same school written for different forms.
  const FAMILIES = [
    ['고등학교','고교','고'],
    ['대학교','대학','대'],
    ['대학원'],
    ['학과','과'],
    ['학부'],
    ['전공']
  ];
  function familyOf(suffix){
    const s=core(suffix);
    return FAMILIES.find(f=>f.includes(s))||null;
  }
  // Split "예시대학교 수원캠퍼스" / "예시대학교(수원캠퍼스)" into the name and the campus note.
  function stripCampus(value){
    let v=String(value??'').trim();
    v=v.replace(/\s*[([（][^)\]）]*(캠퍼스|분교|본교|campus)[^)\]）]*[)\]）]\s*$/i,'');
    v=v.replace(/\s+\S*(캠퍼스|분교|campus)$/i,'');
    return v.trim();
  }
  function stem(value){
    const v=stripCampus(value).replace(/\s+/g,'');
    for(const family of FAMILIES)for(const end of family){
      if(v.length>end.length+1 && v.endsWith(end)){
        // "컴퓨터공학과" keeps the 학: the department is 컴퓨터공학.
        if(family[0]==='학과')return {stem:v.slice(0,-1),family,end:'과'};
        return {stem:v.slice(0,-end.length),family,end};
      }
    }
    return {stem:v,family:null,end:''};
  }
  // Forms worth trying when a search box or list does not know the full stored name.
  function variants(value, topic=''){
    const raw=String(value??'').trim();
    if(!raw)return [];
    const out=[raw];
    const plain=stripCampus(raw);out.push(plain);
    const {stem:base,family}=stem(plain);
    if(family){
      if(family[0]==='고등학교')out.push(base+'고등학교',base+'고',base);
      else if(family[0]==='대학교')out.push(base+'대학교',base+'대학',base+'대',base);
      else if(family[0]==='학과')out.push(base);
      else out.push(base);
    }
    if(topic==='major' && base.length>2)out.push(Array.from(base).slice(0,2).join(''));
    return [...new Set(out.map(s=>s.trim()).filter(s=>Array.from(s).length>=2))];
  }
  // Two names refer to the same thing when one's stem appears in the other.
  function similar(a,b){
    const x=core(stripCampus(a)),y=core(stripCampus(b));
    if(!x||!y)return false;
    if(x===y)return true;
    const sx=core(stem(a).stem),sy=core(stem(b).stem);
    if(Array.from(sx).length>=2 && sx===sy)return true;
    return x.includes(y)||y.includes(x);
  }
  // Same school/major/organisation: differs only by campus/region notes or the name ending.
  const REGION=/서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|충청|전북|전남|전라|경북|경남|경상|제주|본교|분교|캠퍼스|campus|[가-힣]{1,4}[시군구도]$/i;
  function bareName(value){
    let v=stripCampus(value);
    for(let i=0;i<2;i++)v=v.replace(/\s*[([（]([^)\]）]*)[)\]）]\s*$/,(all,inner)=>REGION.test(inner.trim())||inner.trim().split(/[\s,]+/).every(w=>REGION.test(w))?'':all);
    return v.trim();
  }
  function sameEntity(a,b){
    const x=bareName(a),y=bareName(b);
    if(!x||!y)return false;
    if(core(x)===core(y))return true;
    const sx=core(stem(x).stem),sy=core(stem(y).stem);
    return Array.from(sx).length>=2 && sx===sy && (stem(x).family===stem(y).family||!stem(x).family||!stem(y).family);
  }
  // Majors: "데이터사이언스융합전공" = "데이터사이언스융합학" = "…학과" = "…학부".
  const majorCore=v=>core(bareName(v)).replace(/(학과|학부|전공|과|학)$/,'');
  function sameMajor(a,b){const x=majorCore(a),y=majorCore(b);return Array.from(x).length>=2&&x===y;}
  // A literal typed into a form must be the stored value or a contiguous part of it.
  function derivedFrom(literal, source){
    const l=core(literal),s=core(source);
    if(!l||!s)return false;
    if(l===s)return true;
    // Another written form of the same name (동탄국제고 ↔ 동탄국제고등학교) is also the stored fact.
    if(variants(source).some(v=>core(v)===l))return true;
    return s.includes(l) && Array.from(l).length>=Math.min(2,Array.from(s).length);
  }
  const INSTRUCTION=/제외|빼고|생략|없이|까지만|만\s*입력|약칭|줄여|예\s*[):]|예시|ex\)|e\.g|형식|형태|→|->|⇒/i;
  // Rule-level adaptation of a stored text to what the form asks for.
  // Returns needsJudgment when the field carries instructions the rules cannot settle.
  function adaptText(value, hints={}, maxLength=-1){
    const original=String(value??'');
    let v=original, reason='';
    const suffix=String(hints.suffix||'').trim();
    const help=[hints.help,hints.placeholder,hints.title].filter(Boolean).join(' ');
    const dropEnding=family=>{
      const s=stem(v);
      if(s.family===family){v=s.stem;return true;}
      return false;
    };
    // "[ 동탄국제 ] 고등학교": the form prints the ending after the box.
    if(suffix){
      const family=familyOf(suffix);
      if(family && dropEnding(family))reason='matched the "'+suffix+'" after the box';
    }
    if(!reason && help){
      // "'고등학교'는 제외하고 입력" / "대학교 빼고"
      const m=help.match(/(?:['"‘’“”]?(고등학교|고교|대학교|대학|학교|학과)['"‘’“”]?|['"‘’“”](고|대|과)['"‘’“”])\s*(?:자|글자)?\s*(?:은|는|을|를|이|가|명|자)?\s*(?:제외|빼고|생략|없이)/);
      const excluded=m&&[m[0],m[1]||m[2]];
      if(excluded){
        const family=excluded[1]==='학교'?(stem(v).family?.[0]==='고등학교'||stem(v).family?.[0]==='대학교'?stem(v).family:null):familyOf(excluded[1]);
        if(family&&dropEnding(family))reason='"'+excluded[1]+'" removed as instructed';
      }
    }
    if(!reason && help){
      // "예) 서울고등학교 → 서울": learn the dropped ending from the example pair.
      for(const pair of help.matchAll(/([가-힣A-Za-z0-9]+)\s*(?:-+>|→|⇒|=>)\s*([가-힣A-Za-z0-9]+)/g)){
        const [,from,to]=pair;
        if(from.startsWith(to) && from.length>to.length){
          const family=familyOf(from.slice(to.length));
          if(family && dropEnding(family)){reason='matched the example ('+from+'→'+to+')';break;}
        }
      }
    }
    const changed=v!==original;
    const tooLong=maxLength>0 && Array.from(v).length>maxLength;
    const needsJudgment=tooLong || (!changed && INSTRUCTION.test(help) && /학교|학과|전공|기관|회사|명|이름|name/i.test(help+' '+(hints.label||'')));
    return {value:v,changed,needsJudgment,tooLong,reason};
  }

  // ---- Choices ------------------------------------------------------------
  const EQUIV=[
    ['남','남자','남성','male','m','男'],['여','여자','여성','female','f','女'],
    ['대상','해당','예','yes','y','있음','유','해당있음'],['비대상','해당없음','비해당','아니오','아니요','no','n','없음','무','해당사항없음','미해당'],
    ['군필','필','병역필','복무완료','만기전역','전역','제대'],['만기전역','만기제대','만기','전역'],['소집해제','소집해제(보충역)','사회복무요원'],['미필','병역미필'],['면제','병역면제'],['복무중','현역','복무'],
    ['졸업','졸'],['졸업예정','졸예','졸업예정자','졸업(예)','졸업예','졸(예)','졸업예상','졸업예정(예)'],['수료예정','수료(예)','수료예'],['재학','재학중'],['휴학','휴학중'],['중퇴','중도퇴학','자퇴'],['수료'],['편입'],
    ['재직','재직중','현직','현재재직중'],['퇴사','퇴직'],
    ['학사'],['석사'],['박사'],['전문학사'],
    ['육군'],['해군'],['공군'],['해병대','해병'],['의무경찰','의경'],['사회복무요원','공익','사회복무']
  ];
  const equivClasses=v=>{const c=core(v);return c?EQUIV.map((g,i)=>g.some(x=>core(x)===c)?i:-1).filter(i=>i>=0):[];};
  const PLACEHOLDER=/^(선택|선택하세요|선택해주세요|선택하십시오|select|choose|selectanoption|chooseanoption|전체|-+)$/;
  // Pick one option for a stored value. Returns {index} when unique, {ambiguous:[...]} when
  // several fit equally, or null. Loose (containment) matches are flagged.
  function matchOption(options, desired){
    const d=core(desired);
    if(!d)return null;
    const labels=options.map(o=>core(o.label)), values=options.map(o=>core(o.value));
    const live=i=>labels[i]&&!PLACEHOLDER.test(labels[i]);
    const pick=(idx,extra={})=>idx.length===1?{index:idx[0],...extra}:idx.length>1?{ambiguous:idx}:null;
    const where=test=>options.map((_,i)=>i).filter(i=>live(i)&&test(i));
    let r=pick(where(i=>labels[i]===d)); if(r)return r;
    r=pick(where(i=>values[i]&&values[i]===d&&(!/^\d+$/.test(d)||labels[i].includes(d)))); if(r)return r;
    const ec=equivClasses(desired);
    if(ec.length){r=pick(where(i=>equivClasses(options[i].label).some(c=>ec.includes(c)))); if(r)return r;}
    const digits=d.replace(/[년월일]/g,'');
    if(/^\d+$/.test(digits)){
      r=pick(where(i=>{const l=labels[i].replace(/[년월일]/g,'');return /^\d+$/.test(l)&&Number(l)===Number(digits);}));
      if(r)return r;
    }
    const dv=variants(desired).map(core);
    r=pick(where(i=>dv.includes(labels[i])||variants(options[i].label).map(core).includes(d)),{loose:true}); if(r)return r;
    if(Array.from(d).length>=2){
      const hits=where(i=>Array.from(labels[i]).length>=2&&(labels[i].includes(d)||d.includes(labels[i])));
      // Several options sit inside the stored value ("졸업", "졸업예" ⊂ "졸업예정"): the longest is the more specific answer.
      const inside=hits.filter(i=>d.includes(labels[i])&&labels[i]!==d);
      if(hits.length>1&&inside.length===hits.length){
        const longest=Math.max(...inside.map(i=>labels[i].length));
        const top=inside.filter(i=>labels[i].length===longest);
        if(top.length===1)return {index:top[0],loose:true};
      }
      r=pick(hits,{loose:true});
      if(r)return r;
    }
    return null;
  }

  // "2013.3", "2013년 3월", "201303", "2013/03/02" → normalised before the strict parsers.
  function tidyDate(value){
    const v=String(value??'').trim();
    let m=v.match(/^(\d{4})\s*(?:년|[-./])\s*(\d{1,2})\s*(?:월)?(?:\s*(?:[-./]|월)?\s*(\d{1,2})\s*일?)?\.?$/);
    if(m)return m[3]?m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0'):m[1]+'-'+m[2].padStart(2,'0');
    m=v.match(/^(\d{4})(\d{2})$/);if(m)return m[1]+'-'+m[2];
    return v;
  }
  function transform(value, kind) {
    if(/^(record|month|date|birth)/.test(kind))value=tidyDate(value);
    if(kind==='recordYear'||kind==='recordMonth')return transform(value,'monthISO').split('-')[kind==='recordYear'?0:1];
    if(kind==='recordDay')return birth(value)[2];
    if (kind === 'identity') return String(value);
    if(kind==='phoneDigits')return phone(value).join('');
    if(kind==='dateISO')return birth(value).join('-');
    if(kind==='birthDigits')return birth(value).join('');
    if(kind==='birthYYMMDD'){const parts=birth(value);return parts[0].slice(-2)+parts[1]+parts[2];}
    if(kind==='monthISO'){
      const match=String(value).match(/^(\d{4})[-./](\d{1,2})$/);
      if(match){if(Number(match[2])<1||Number(match[2])>12)throw Error('Invalid month.');return match[1]+'-'+match[2].padStart(2,'0');}
      return birth(value).slice(0,2).join('-');
    }
    if (/^phone[012]$/.test(kind)) return phone(value)[Number(kind.slice(-1))];
    if (['birthYear','birthMonth','birthDay'].includes(kind)) return birth(value)[['birthYear','birthMonth','birthDay'].indexOf(kind)];
    if (kind === 'emailLocal' || kind === 'emailDomain') {
      const parts = String(value).split('@'); if (parts.length !== 2 || !parts.every(Boolean)) throw Error('Check the email.');
      return parts[kind === 'emailLocal' ? 0 : 1];
    }
    throw Error('Unsupported format.');
  }
  // ---- Closest candidate (0..1) -------------------------------------------
  // Used when no result is an exact fit: the best-scoring one is chosen and shown for human review.
  function bigrams(v){const a=Array.from(v);if(a.length<2)return a;const out=[];for(let i=0;i<a.length-1;i++)out.push(a[i]+a[i+1]);return out;}
  function dice(a,b){
    const x=bigrams(a),y=bigrams(b);if(!x.length||!y.length)return 0;
    const left=new Map();for(const g of x)left.set(g,(left.get(g)||0)+1);
    let hit=0;for(const g of y){const n=left.get(g);if(n){hit++;left.set(g,n-1);}}
    return 2*hit/(x.length+y.length);
  }
  // Notes a stored name does not have: a different programme, not the same department.
  const EXTRA_NOTE=/야간|계약|산업체|재직자|위탁|평생|사이버|원격|외국인|특별과정|학점은행|\(.+\)/;
  const roadKey=v=>{const m=/([가-힣A-Za-z0-9]+(?:대로|로|길))\s*(\d+(?:-\d+)?)/.exec(String(v??'').replace(/\s+(?=\d)/g,' '));return m?{road:core(m[1]),num:m[2]}:null;};
  function addressScore(candidate,query,postcode=''){
    let s;
    if(addressMatches(candidate,query))s=0.97;
    else{
      const q=roadKey(query),c=roadKey(candidate);
      if(q&&c&&q.road===c.road&&q.num===c.num)s=0.93;
      else if(q&&c&&q.road===c.road)s=0.55+0.2*dice(core(candidate),core(query));
      else s=0.8*dice(core(candidate),core(query));
    }
    if(postcode&&String(candidate).includes(postcode))s=Math.min(0.99,s+0.05);
    return s;
  }
  function score(candidate,query,topic=''){
    const c=String(candidate??''),q=String(query??'');
    if(!core(c)||!core(q))return 0;
    if(core(c)===core(q))return 1;
    if(topic==='address')return addressScore(c,q);
    const key=v=>topic==='major'?majorCore(v):core(stem(bareName(v)).stem);
    const ck=key(c),qk=key(q);
    let s=0.6*dice(core(bareName(c)),core(bareName(q)));
    if(ck&&ck===qk)s+=0.35;
    else if(Array.from(ck).length>=2&&Array.from(qk).length>=2&&(ck.includes(qk)||qk.includes(ck)))s+=0.15;
    if(sameEntity(c,q))s=Math.max(s,0.9);
    if(EXTRA_NOTE.test(c)&&!EXTRA_NOTE.test(q))s-=0.15;
    return Math.max(0,Math.min(0.99,s));
  }
  // Highest score first; ties keep the list's own order.
  function rank(candidates,query,topic='',nameOf=x=>x){
    return candidates.map((item,index)=>({item,index,name:nameOf(item),score:score(nameOf(item),query,topic)})).sort((a,b)=>b.score-a.score||a.index-b.index);
  }
  // A different building number is a different place, so addresses need a near-certain fit.
  const AUTO_PICK=topic=>topic==='address'?0.85:0.6;
  globalThis.JobSeekerValues = { score, addressScore, rank, AUTO_PICK, norm, core, phone, birth, gender, transform, addressMatches, variants, similar, derivedFrom, adaptText, matchOption, stem, sameEntity, sameMajor, bareName, PLACEHOLDER };
})();
