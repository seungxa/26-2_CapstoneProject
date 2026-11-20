import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { flatten,suggest } from '../matching.js';
import { planForSource } from '../planner.js';
import '../values.js';
import {fieldMappings,signatureFor} from '../mappings.js';
const V=globalThis.JobSeekerValues;
test('network access lives only in the optional AI module; no local relay server',async()=>{
  const root=new URL('../',import.meta.url),files=await readdir(root);
  assert.ok(!files.includes('model-server'));
  for(const file of files.filter(file=>file.endsWith('.js')&&file!=='llm.js')){const code=await readFile(new URL(file,root),'utf8');assert.doesNotMatch(code,/\bfetch\s*\(|XMLHttpRequest|8766|JS_MODEL|modelPlan|checkModel/,file);}
  const llm=await readFile(new URL('llm.js',root),'utf8');assert.doesNotMatch(llm,/8766|eval\(|new Function/);
});
test('education/career date labels resolve without an explicit section',()=>{
  const sources=flatten({education:[{start:'2020-03',end:'2024-02',status:'졸업'}],experience:[{start:'2024-03',end:'2025-01',status:'퇴사'}]});
  assert.equal(suggest({label:'입학일'},sources).group,'education');assert.equal(suggest({label:'입사일'},sources).group,'experience');assert.equal(suggest({label:'졸업구분'},sources).group,'education');
});
test('autocomplete and dangerous semantic collisions remain conservative',()=>{
  const sources=flatten({profile:{name:'지원자',phone:'010-1234-5678',birth:'2000-02-29',address:'예시로 123'}});
  assert.equal(suggest({label:'생소한 항목',autocomplete:'bday'},sources).key,'birth');
  assert.equal(suggest({label:'Emergency phone'},sources),null);assert.equal(suggest({label:'School name'},sources),null);assert.equal(suggest({label:'상세주소'},sources),null);
  assert.equal(suggest({label:'Company phone'},sources),null);assert.equal(suggest({label:'Company address'},sources),null);assert.equal(suggest({label:'부모 생년월일'},sources),null);
});
test('single birth/phone/date fields use format transformations without inventing precision',()=>{
  const birth={key:'birth',path:'profile.0.birth'},phone={key:'phone',path:'profile.0.phone'};
  assert.equal(planForSource({controls:[{id:'c0',kind:'text',maxLength:6}]},birth).assignments[0].transform,'birthYYMMDD');
  assert.equal(planForSource({controls:[{id:'c0',kind:'text',maxLength:11}]},phone).assignments[0].transform,'phoneDigits');
  assert.deepEqual(planForSource({controls:[{id:'c0',kind:'text',maxLength:4},{id:'c1',kind:'text',maxLength:4}]},phone).assignments.map(a=>a.transform),['phone1','phone2']);
  assert.equal(V.transform('2000.2.9','dateISO'),'2000-02-09');assert.equal(V.transform('2000-02-09','birthYYMMDD'),'000209');assert.equal(V.transform('2024-3','monthISO'),'2024-03');assert.throws(()=>V.transform('2024-03','dateISO'));
});
test('address numeric boundaries do not conflate building 123 with 1234 or 123-4',()=>{
  assert.equal(V.addressMatches('서울시 예시로 123 (예시동)','서울시 예시로 123'),true);
  assert.equal(V.addressMatches('서울시 예시로 1234','서울시 예시로 123'),false);
  assert.equal(V.addressMatches('서울시 예시로 123-4','서울시 예시로 123'),false);
  assert.equal(V.addressMatches('서울시 예시로','서울시 예시로'),false);
});
test('learned mapping is origin scoped, stores no values, and never picks a repeated record',async()=>{
  const data={},api={storage:{local:{async get(){return data;},async set(value){Object.assign(data,value);},async remove(key){delete data[key];}}}};
  const field={label:'사용자 지정',controls:[{kind:'text',name:'x',maxLength:20}]},source={group:'profile',key:'name',value:'private-name'};
  await fieldMappings.save('https://one.example',field,source,api);assert.ok(!JSON.stringify(data).includes('private-name'));
  assert.equal((await fieldMappings.find('https://one.example',field,[source],api)).key,'name');assert.equal(await fieldMappings.find('https://two.example',field,[source],api),null);
  assert.equal(await fieldMappings.find('https://one.example',field,[source,source],api),null);
  assert.equal(signatureFor(field),signatureFor({...field,value:'different private value'}));
  await fieldMappings.forget('https://one.example',field,api);assert.equal(await fieldMappings.find('https://one.example',field,[source],api),null);
});
