import {test,expect} from '@playwright/test';
test('team header and protected deep links host the practice module without a second application layout',async({page})=>{
 await page.goto('/practice/history');
 await expect(page.getByRole('heading',{name:'History',exact:true})).toBeVisible();
 await expect(page.locator('.site-header')).toBeVisible();
 await expect(page.locator('.feature-nav').getByRole('link',{name:'Practice',exact:true})).toBeVisible();
 await expect(page.locator('.practice-track')).toHaveCount(1);
 await expect(page.locator('main')).toHaveCount(1);
 await page.locator('.feature-nav').getByRole('link',{name:'Track',exact:true}).click();
 await expect(page).toHaveURL(/\/track$/);await expect(page.getByRole('heading',{name:'Applications',exact:true})).toBeVisible();
 await expect(page.locator('.site-header')).toHaveCount(1);
});

test('dashboard stays independent and feature styles do not change the existing profile or header',async({page})=>{
 const featureRequests:string[]=[];
 page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/src/features/practice-track/'))featureRequests.push(request.url());});
 await page.route('**/rest/v1/profiles*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{archive:null}])}));
 await page.goto('/');await expect(page.getByRole('heading',{name:'Welcome to JobSeeker!',exact:true})).toBeVisible();
 expect(featureRequests).toHaveLength(0);
 const header=await page.locator('.site-header').evaluate(element=>getComputedStyle(element).backgroundColor);
 await page.locator('.dashboard-card[href="/practice"]').click();await expect(page.getByRole('heading',{name:'Practice',exact:true})).toBeVisible();
 expect(featureRequests.length).toBeGreaterThan(0);
 await page.locator('.feature-nav').getByRole('link',{name:'Profile',exact:true}).click();
 await expect(page.getByRole('heading',{name:'My Profile',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'기본정보',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())).toBe('');
 expect(await page.locator('.site-header').evaluate(element=>getComputedStyle(element).backgroundColor)).toBe(header);
 await expect(page.locator('.practice-track')).toHaveCount(0);
});


test('practice tab shows only practice links',async({page})=>{
 const feature=page.locator('.practice-track');
 const menu=feature.getByRole('navigation');
 await page.goto('/practice');
 await expect(menu.getByRole('link')).toHaveText(['Start','History','Settings']);
 await expect(feature).toHaveAttribute('lang','en');
 // Wait for the health check so a status line would already be on screen if it still existed.
 await page.waitForLoadState('networkidle');
 await expect(feature.locator(':scope > *')).toHaveCount(2); // the menu and the page, nothing above the page
 await expect(feature).not.toContainText(/음성 전사:|Transcription is/);
 await page.goto('/track');
 await expect(menu.getByRole('link')).toHaveText(['Applications','Board','Stats']);
 await page.waitForLoadState('networkidle');
 await expect(feature.locator(':scope > *')).toHaveCount(2);
 await menu.getByRole('link',{name:'Stats',exact:true}).click();
 await expect(page).toHaveURL(/\/track\/stats$/);
});

test('history names each session in English and keeps the skill filter',async({page})=>{
 const at='2026-11-14T09:04:00';
 const row=(id:string,mode:'free'|'mock',title:string,extra:object={})=>({id,mode,title,created_at:at,finished_at:at,answer_count:2,recorded_count:1,avg_rating:3.5,competency_keys:['communication'],classification_missing_count:0,...extra});
 await page.route(url=>url.port==='8011'&&url.pathname==='/practice/sessions',route=>route.request().method()==='GET'?route.fulfill({json:[
  row('s-free','free','자유 연습 11/14 18:04'),
  row('s-mock','mock','모의 면접 11/14 18:04',{finished_at:null,avg_rating:null,competency_keys:['collaboration'],classification_missing_count:1}),
  row('s-again','free','보완 연습 · 자유 연습 11/14 18:04'),
 ]}):route.continue());
 await page.goto('/practice/history');
 await expect(page.getByRole('heading',{level:1})).toHaveText('History');
 const table=page.getByRole('table');
 await expect(table.getByRole('columnheader')).toHaveText(['Session','Recorded','Avg. Self-Rating']);
 await expect(table.getByRole('link')).toHaveText([/^Practice · Nov 14, \d\d:\d\d$/,/^Mock Interview · Nov 14, \d\d:\d\d$/,/^Practice Again · Nov 14, \d\d:\d\d$/]);
 const mock=page.getByRole('row').filter({has:page.getByRole('link',{name:/^Mock Interview/})});
 await expect(mock).toContainText('In Progress');
 await expect(mock).toContainText('Collaboration');
 await expect(mock).toContainText('1 untagged');
 await expect(mock.getByRole('cell')).toHaveText([/Mock Interview/,'1 / 2','–']);
 await expect(page.locator('.practice-track')).not.toContainText(/[가-힣]/);
 const skill=page.getByRole('combobox',{name:'Filter by skill',exact:true});
 await expect(skill.locator('option').first()).toHaveText('All Skills');
 await skill.selectOption('collaboration');
 await expect(table.getByRole('link')).toHaveCount(1);
 await skill.selectOption('leadership');
 await expect(page.getByText('No sessions match.',{exact:true})).toBeVisible();
});
