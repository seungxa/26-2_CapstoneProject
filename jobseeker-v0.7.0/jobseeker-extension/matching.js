export const schema = {
  profile: { name: 'Name (Korean)', nameHanja: 'Name (Hanja)', nameEnglish: 'Name (English)', birth: 'Birth date (YYYY-MM-DD)', gender: 'Gender', veteran: 'Veteran status (e.g. 대상 (5%), 비대상)', veteranNumber: 'Veteran number', disability: 'Disability (대상 / 비대상)', email: 'Email', phone: 'Mobile', emergencyPhone: 'Emergency contact', postcode: 'Postcode', address: 'Address (road name)', addressDetail: 'Address detail' },
  military: { serviceStatus:'Service status', branch:'Branch', specialty:'Specialty', rankName:'Rank', start:'Service start', end:'Service end', discharge:'Discharge reason', exemption:'Exemption reason' },
  language: { languageName:'Language', exam:'Test', score:'Score', grade:'Grade', number:'Registration no.', date:'Date', speaking:'Speaking', reading:'Reading', writing:'Writing' },
  license: { credential:'Certificate', grade:'Grade', number:'Registration no.', issuer:'Issuer', date:'Date acquired' },
  response: { site:'Site (host)', posting:'Job posting (page title)', question:'Question (as on the site)', answer:'Answer' },
  education: { tier:'School level', affiliation:'Field (e.g. 공학, 인문, 상경)', location:'Location', minor:'Minor', doubleMajor:'Double major', gpa:'GPA', scale:'GPA scale', school: 'School', major: 'Major', start: 'Start (YYYY-MM)', end: 'Graduation (YYYY-MM)', status: 'Status (e.g. 졸업, 졸업예정)', degree: 'Degree' },
  experience: { employmentType:'Employment type', position:'Position', leaving:'Reason for leaving', company: 'Company', department: 'Department', role: 'Role', start: 'Start (YYYY-MM)', end: 'End (YYYY-MM)', status: 'Status (e.g. 재직, 퇴사)', description: 'Duties' },
  activity: { title: 'Activity', organization: 'Organizer', category: 'Type', start: 'Start (YYYY-MM)', end: 'End (YYYY-MM)', description: 'Description' },
  award: { title: 'Award', organization: 'Awarded by', date: 'Date', rank: 'Rank' }
};
export const groupNames = { military:'Military service', language:'Languages', license:'Certificates', response:'Saved answers', profile: 'Profile', education: 'Education', experience: 'Experience', activity: 'Activities', award: 'Awards' };
const aliases = {
  veteran: ['취업지원대상자','취업지원대상자여부','보훈여부'], veteranNumber: ['보훈번호'], disability: ['장애','장애여부'],
  name: ['성명', '이름', '성함', '지원자명', 'fullname', 'name'], nameHanja: ['한자', '한자이름', '한자성명', 'hanjaname', 'namehanja'], nameEnglish: ['영문', '영문이름', '영문성명', 'englishname', 'nameenglish'], birth: ['생년월일', '생일', '출생일', 'birthday', 'birthdate', 'dateofbirth', 'dob'], gender: ['성별', 'gender', 'sex'],
  email: ['이메일', '이메일주소', '전자우편', '전자우편주소', 'email', 'Email주소', 'email address'], phone: ['휴대폰', '휴대전화', '핸드폰', '휴대폰번호', '휴대전화번호', '핸드폰번호', '휴대폰 연락처', '연락처', '전화번호', '휴대번호', 'mobile', 'phone', 'mobilephone', 'cellphone', 'phonenumber'], emergencyPhone: ['비상연락처', '긴급연락처', 'emergencyphone'], postcode: ['우편번호', '우편', 'zipcode', 'postcode'], address: ['현주소', '기본주소', '도로명주소', '주소', 'address'], addressDetail: ['상세주소', '상세', '상세주소입력', 'addressdetail'],
  school: ['학교명', '대학교명', 'school', 'university'], major: ['전공', '학과', 'major'], degree: ['학위', 'degree'],
  company: ['회사명', '직장명', 'company'], department: ['부서', 'department'], role: ['직무', '직위', 'role'],
  organization: ['주관기관', '주최기관', '수여기관', '발급기관', 'organization'], title: ['활동명', '수상명', '대회명', 'title'],
  start: ['입학년월', '입학일', '입사년월', '입사일', '시작년월', '시작일', 'startdate'], end: ['졸업년월', '졸업일', '퇴사년월', '퇴사일', '종료년월', '종료일', 'enddate'],
  status: ['졸업구분', '졸업상태', '재직구분', '재직상태', 'status'], description: ['담당업무', '활동내용', 'description'],
  category: ['활동구분', '활동유형', 'category'], date: ['수상일', '수상년월', 'awarddate'], rank: ['수상등급', '수상내역', 'rank']
};
export const normalize = value => String(value ?? '').toLowerCase().replace(/[\s_\-:：*()（）/\.]/g, '');
export function flatten(archive) {
  const out = [];
  for (const [group, fields] of Object.entries(schema)) {
    const records = group === 'profile' ? [archive.profile || {}] : archive[group] || [];
    records.forEach((record, index) => {
      for (const [key, label] of Object.entries(fields)) {
        if (record[key] !== undefined && String(record[key]).trim()) out.push({ path: `${group}.${index}.${key}`, group, key, index, value: String(record[key]), label: `${groupNames[group]} ${group === 'profile' ? '' : index + 1} · ${label}` });
      }
    });
  }
  return out;
}
export function suggest(field, sources) {
  sources=sources.filter(source=>!['language','license','military','response'].includes(source.group));
  const label = normalize(field.label);
  const hints = normalize(`${field.name || ''} ${field.id || ''} ${field.placeholder || ''}`);
  const context = normalize(field.section || '');
  const domains={education:['학력','입학','졸업','학교','전공','학위','education'],experience:['경력','근무','입사','퇴사','재직','회사','부서','직무','experience'],activity:['활동','activity'],award:['수상','수여','award']};
  const directGroups=Object.entries(domains).filter(([,words])=>words.some(w=>label.includes(w))).map(([g])=>g);
  const groups=directGroups.length?directGroups:Object.entries(domains).filter(([,words])=>words.some(w=>context.includes(w))).map(([g])=>g);
  const autocomplete=String(field.autocomplete||'').split(/\s+/).at(-1);
  const standard={name:'name',email:'email',tel:'phone',sex:'gender',bday:'birth','bday-year':'birth','bday-month':'birth','bday-day':'birth','postal-code':'postcode','street-address':'address','address-line1':'address','address-line2':'addressDetail'}[autocomplete];
  const scored = sources.map(source => {
    if (source.key === 'name' && /영문|한자|보호자|부모|학교|회사|기관|english|hanja|chinese|school|company|organization|parent/i.test(field.label)) return { ...source, score: 0 };
    if(source.key==='phone'&&/비상|긴급|emergency|회사|기관|학교|직장|보호자|부모|company|office|parent/i.test(field.label))return {...source,score:0};
    if(source.key==='address'&&/상세|detail|회사|학교|기관|직장|company|school|office/i.test(field.label))return {...source,score:0};
    if(['birth','gender'].includes(source.key)&&/보호자|부모|배우자|자녀|parent|spouse|child/i.test(field.label))return {...source,score:0};
    if(source.key==='school'&&/고등학교|highschool/i.test(label))return {...source,score:0};
    const words = aliases[source.key] || [];
    if (['veteran','veteranNumber','disability'].includes(source.key) && !words.some(w=>normalize(w)===label)) return {...source,score:0};
    let score = words.some(w => label === normalize(w)) ? 100 : words.some(w => label.includes(normalize(w))) ? 70 : words.some(w => hints.includes(normalize(w))) ? 45 : 0;
    if(standard===source.key)score=Math.max(score,100);
    if (score && groups.length === 1) score += groups.includes(source.group) ? 20 : -80;
    return { ...source, score };
  }).filter(x => x.score >= 70).sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  // Repeated records and competing meanings always require an explicit choice.
  if (scored[1]?.score === scored[0].score) return null;
  return scored[0];
}


// The profile item a label names, even when the archive value is empty (then the box is left alone).
export function profileKey(field){return Object.keys(schema.profile).find(key=>(aliases[key]||[]).some(w=>normalize(w)===normalize(field.label)));}
export function stageSource(field,sources){return sources.find(s=>s.group==='profile' && (aliases[s.key]||[]).some(w=>normalize(w)===normalize(field.label)));}
