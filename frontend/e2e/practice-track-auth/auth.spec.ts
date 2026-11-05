import {test,expect} from '@playwright/test';
import {sessionFor,userA} from '../../tests/practice-track/support/config';
const api='http://127.0.0.1:8021',userB='00000000-0000-0000-0000-000000000002';
const headers=(subject:string)=>({Authorization:`Bearer ${sessionFor(subject).access_token}`});
async function seedVoice(page:import('@playwright/test').Page){
 await page.evaluate(async()=>{const path='/src/features/practice-track/delivery/voice.ts';const voice=await import(path);voice.saveVoiceSegment('synthetic-session','synthetic-answer',voice.summarizeVoice([],4),'synthetic-revision');});
}
async function hasVoice(page:import('@playwright/test').Page){return page.evaluate(async()=>{const path='/src/features/practice-track/delivery/voice.ts';const voice=await import(path);return !!voice.getVoiceSegment('synthetic-session','synthetic-answer','synthetic-revision');});}
test('real signed bearer tokens isolate Track and switching users clears old drafts and observations',async({page,request})=>{
 const name=`사용자 A 전용 ${Date.now()}`;
 const response=await request.post(`${api}/track/applications`,{headers:headers(userA),data:{company:name,position:'개발'}});expect(response.status()).toBe(201);const app=await response.json();
 const subjects:string[]=[];
 page.on('request',req=>{const url=new URL(req.url());if(url.port==='8021'&&url.pathname==='/track/applications'){
  const token=req.headers().authorization?.replace(/^Bearer /,'');if(token){try{subjects.push(JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).sub);}catch{ /* assertion below catches invalid transport */ }}
 }});
 await page.goto('/track');await expect(page.getByRole('link',{name:new RegExp(name)})).toBeVisible();
 await seedVoice(page);expect(await hasVoice(page)).toBe(true);
 await page.getByRole('button',{name:'+ 지원 건 추가',exact:true}).click();await page.getByLabel('회사',{exact:true}).fill('A의 저장 전 입력');
 await page.evaluate(async value=>{const path='/src/lib/supabase.ts';const {supabase}=await import(path);const {error}=await supabase.auth.setSession(value);if(error)throw error;},sessionFor(userB));
 await expect(page.getByRole('heading',{name:'지원 관리',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:new RegExp(name)})).toHaveCount(0);expect(await page.locator('input').evaluateAll(inputs=>inputs.map(input=>input.value))).not.toContain('A의 저장 전 입력');
 expect(await hasVoice(page)).toBe(false);
 await expect.poll(()=>subjects.includes(userB)).toBe(true);expect(subjects).toContain(userA);
 expect((await request.get(`${api}/track/applications/${app.id}`,{headers:headers(userB)})).status()).toBe(404);
 expect((await request.get(`${api}/track/applications/${app.id}`,{headers:headers(userA)})).status()).toBe(200);
});
test('logout away from the feature clears its tab observations and protects later deep links',async({page})=>{
 await page.route('**/rest/v1/profiles*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{archive:null}])}));
 await page.goto('/practice');await expect(page.getByRole('heading',{name:'면접 연습',exact:true})).toBeVisible();await seedVoice(page);expect(await hasVoice(page)).toBe(true);
 await page.locator('.feature-nav').getByRole('link',{name:'Profile',exact:true}).click();await expect(page.getByRole('heading',{name:'기본정보',exact:true})).toBeVisible();
 await page.locator('.header-auth').getByRole('button',{name:'Log Out',exact:true}).click();await expect(page.locator('.header-auth').getByRole('link',{name:'Log In',exact:true})).toBeVisible();
 expect(await hasVoice(page)).toBe(false);
 await page.goto('/practice/history');await expect(page).toHaveURL(/\/login$/);await expect(page.locator('.practice-track')).toHaveCount(0);
});
test.describe('team login',()=>{
 test.use({storageState:{cookies:[],origins:[]}});
 test('uses the unchanged team login before accessing protected practice',async({page})=>{
  await page.goto('/practice/history');await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email',{exact:true}).fill('practice@example.invalid');await page.getByLabel('Password',{exact:true}).fill('local-test-only');
  await page.locator('form').getByRole('button',{name:'Log In',exact:true}).click();await expect(page).toHaveURL('http://localhost:5189/');
  await page.locator('.dashboard-card[href="/practice"]').click();await expect(page.getByRole('heading',{name:'면접 연습',exact:true})).toBeVisible();
  await expect(page.locator('.site-header')).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 });
});
