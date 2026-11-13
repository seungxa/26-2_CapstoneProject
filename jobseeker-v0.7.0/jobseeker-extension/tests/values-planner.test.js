import test from 'node:test';
import assert from 'node:assert/strict';
import '../values.js';
import { flatten, suggest } from '../matching.js';
import { rulePlan, validatePlan } from '../planner.js';
const V=globalThis.JobSeekerValues;
test('phone splits without truncation including 82 and 02 prefixes',()=>{
  assert.deepEqual(V.phone('010-1234-5678'),['010','1234','5678']);assert.deepEqual(V.phone('+82 10 1234 5678'),['010','1234','5678']);assert.deepEqual(V.phone('02-123-4567'),['02','123','4567']);assert.throws(()=>V.phone('1234'));
});
test('birth validates actual date and precision',()=>{assert.deepEqual(V.birth('2000-02-29'),['2000','02','29']);assert.throws(()=>V.birth('2001-02-29'));});
test('gender and Hanja name source isolation',()=>{
  assert.equal(V.gender('여'),V.gender('female'));assert.equal(V.gender('남'),V.gender('M'));
  const sources=flatten({profile:{name:'테스트',nameHanja:'試驗',birth:'2000-01-01',gender:'여성'}});
  assert.equal(suggest({label:'한자성명'},sources).key,'nameHanja');assert.equal(suggest({label:'성별'},sources).key,'gender');
});
test('logical phone/date group produces per-control transforms',()=>{
  const sources=flatten({profile:{phone:'010-1234-5678',birth:'2000-01-02'}}),controls=[0,1,2].map(i=>({id:`c${i}`,kind:'text',maxLength:4}));
  assert.deepEqual(rulePlan({label:'휴대폰',kind:'text',controls},sources).assignments.map(a=>a.transform),['phone0','phone1','phone2']);
  assert.deepEqual(rulePlan({label:'생년월일',kind:'text',controls},sources).assignments.map(a=>a.transform),['birthYear','birthMonth','birthDay']);
});
test('reject model controls/source/transforms outside capability',()=>{
  const sources=flatten({profile:{name:'테스트'}}),field={controls:[{id:'c0'}]},good={sourcePath:'profile.0.name',confidence:.99,assignments:[{controlId:'c0',transform:'identity'}]};
  assert.equal(validatePlan(good,field,sources).sourcePath,'profile.0.name');
  for(const bad of [{...good,sourcePath:'invented'},{...good,assignments:[{controlId:'submit',transform:'identity'}]},{...good,assignments:[{controlId:'c0',transform:'eval'}]}])assert.throws(()=>validatePlan(bad,field,sources));
});
