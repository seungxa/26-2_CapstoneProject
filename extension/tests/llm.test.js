import test from 'node:test';
import assert from 'node:assert/strict';
import '../values.js';
import { flatten } from '../matching.js';
import { validateResult, mapFields, pickCandidate, parseJSON, isReady } from '../llm.js';
const sources=flatten({profile:{name:'김예시'},education:[{tier:'대학교',school:'예시대학교 수원캠퍼스',status:'졸업'}],response:[{site:'a.b',posting:'p',question:'q',answer:'비밀 답변'}]});
const text={field:{label:'학교명',controls:[{kind:'text',maxLength:10}]}};
const choice={field:{label:'최종학력',controls:[{kind:'select',options:[{label:'고졸'},{label:'대졸(4년)'}]}]}};
test('accepts derived literals and listed options only',()=>{
  assert.equal(validateResult({sourcePath:'education.0.school',value:'예시대',confidence:.9},text,sources).literal,'예시대');
  assert.match(validateResult({sourcePath:'education.0.school',value:'서울대',confidence:.9},text,sources).error,/not from your archive/);
  assert.equal(validateResult({sourcePath:'education.0.tier',option:'대졸(4년)',confidence:.9},choice,sources).option,'대졸(4년)');
  assert.match(validateResult({sourcePath:'education.0.tier',option:'대학원졸',confidence:.9},choice,sources).error,/not on the page/);
});
test('rejects invented paths, the response group, bad confidence and overlong values',()=>{
  assert.match(validateResult({sourcePath:'profile.0.ssn',confidence:.9},text,sources).error,/not in your archive/);
  assert.match(validateResult({sourcePath:'response.0.answer',confidence:.9},text,sources).error,/not in your archive/);
  assert.match(validateResult({sourcePath:'profile.0.name',confidence:7},text,sources).error,/confidence/);
  assert.match(validateResult({sourcePath:'education.0.school',value:'예시대학교 수원캠퍼스',confidence:.9},text,sources).error,/too long/);
  assert.ok(validateResult({sourcePath:null,confidence:0,reason:'없음'},text,sources).none);
});
test('batch call never sends saved answers and maps results by id',async()=>{
  let sent;
  const fetchImpl=async(url,init)=>{sent=JSON.parse(init.body);return {ok:true,json:async()=>({content:[{type:'text',text:'```json\n{"results":[{"id":"f0","sourcePath":"profile.0.name","value":null,"option":null,"confidence":0.95,"reason":"이름"}]}\n```'}]})};};
  const settings={enabled:true,provider:'anthropic',base:'https://api.anthropic.com/v1',model:'m',apiKey:'k'};
  const out=await mapFields([{id:'f0',field:{label:'지원자 성함',controls:[{kind:'text'}]}}],sources,settings,{fetchImpl});
  assert.equal(out.get('f0').source.path,'profile.0.name');
  assert.ok(!JSON.stringify(sent).includes('비밀 답변'));
  assert.equal(sent.model,'m');
});
test('pick requires a valid index and high confidence',async()=>{
  const settings={enabled:true,provider:'openai',base:'http://127.0.0.1:11434/v1',model:'qwen3:4b',apiKey:''};
  assert.ok(isReady(settings));
  const reply=o=>async()=>({ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify(o)}}]})});
  assert.equal((await pickCandidate({query:'a',label:'x',candidates:['a(본교)','a(분교)']},settings,{fetchImpl:reply({index:0,confidence:.9})})).index,0);
  assert.equal((await pickCandidate({query:'a',label:'x',candidates:['a','b']},settings,{fetchImpl:reply({index:5,confidence:.9})})).index,-1);
  assert.equal((await pickCandidate({query:'a',label:'x',candidates:['a','b']},settings,{fetchImpl:reply({index:1,confidence:.5})})).index,-1);
  assert.throws(()=>parseJSON('no json here'));
});
