import test from 'node:test';
import assert from 'node:assert/strict';
await import('../values.js');
const V=globalThis.JobSeekerValues;
test('suffix printed after the box drops the school ending',()=>{
  assert.equal(V.adaptText('동탄국제고등학교',{suffix:'고등학교'}).value,'동탄국제');
  assert.equal(V.adaptText('동탄국제고',{suffix:'고등학교'}).value,'동탄국제');
  assert.equal(V.adaptText('예시대학교',{suffix:'대학교'}).value,'예시');
  assert.equal(V.adaptText('컴퓨터공학과',{suffix:'학과'}).value,'컴퓨터공학');
  assert.equal(V.adaptText('예시대학교',{suffix:'고등학교'}).changed,false);
});
test('help text exclusions and example pairs',()=>{
  assert.equal(V.adaptText('동탄국제고등학교',{help:"학교명은 '고등학교'를 제외하고 입력하세요"}).value,'동탄국제');
  assert.equal(V.adaptText('동탄국제고등학교',{help:'예) 서울고등학교 → 서울'}).value,'동탄국제');
  assert.equal(V.adaptText('예시대학교',{help:'학교명 입력 (예: 한국대학교)'}).changed,false);
});
test('unsettled instructions and overlong values ask for judgment',()=>{
  assert.equal(V.adaptText('예시대학교 수원캠퍼스',{help:'학교명은 약칭으로 입력',label:'학교명'}).needsJudgment,true);
  assert.equal(V.adaptText('가나다라마바사',{},4).needsJudgment,true);
  assert.equal(V.adaptText('김예시',{}).needsJudgment,false);
});
test('derived literals only',()=>{
  assert.ok(V.derivedFrom('동탄국제','동탄국제고등학교'));
  assert.ok(V.derivedFrom('예시대학교','예시대학교 수원캠퍼스'));
  assert.ok(!V.derivedFrom('서울대','예시대학교'));
  assert.ok(!V.derivedFrom('','예시'));
});
test('search variants',()=>{
  assert.deepEqual(V.variants('동탄국제고등학교'),['동탄국제고등학교','동탄국제고','동탄국제']);
  assert.ok(V.variants('예시대학교 수원캠퍼스').includes('예시대'));
  assert.ok(V.similar('동탄국제고등학교','동탄국제고등학교(경기 화성)'));
  assert.ok(V.similar('동탄국제고','동탄국제고등학교'));
  assert.ok(!V.similar('동탄고등학교','동탄국제고등학교'));
});
test('option matching',()=>{
  const o=l=>l.map((label,i)=>({label,value:String(i)}));
  assert.deepEqual(V.matchOption(o(['선택','남','여']),'남성'),{index:1});
  assert.deepEqual(V.matchOption(o(['대상','비대상']),'해당없음'),{index:1});
  assert.deepEqual(V.matchOption(o(['선택','군필','미필','면제']),'만기전역'),{index:1});
  assert.equal(V.matchOption(o(['선택','2019년','2020년']),'2020').index,2);
  assert.equal(V.matchOption(o(['서울특별시','경기도']),'서울').index,0);
  assert.ok(V.matchOption(o(['대학교(4년)','대학교(2,3년)']),'대학교').ambiguous);
  assert.equal(V.matchOption(o(['고졸','초대졸','대졸']),'대학교'),null);
  assert.equal(V.matchOption(o(['동탄고등학교','동탄국제고등학교(경기)']),'동탄국제고').index,1);
});
test('quoted single-letter endings and family expansions',()=>{
  assert.equal(V.adaptText('동탄국제고',{help:"학교명에서 '고'는 빼고 입력"}).value,'동탄국제');
  assert.ok(V.derivedFrom('동탄국제고등학교','동탄국제고'));
  assert.ok(V.derivedFrom('예시대학교','예시대'));
  assert.ok(!V.derivedFrom('예시고등학교','예시대학교'));
});
