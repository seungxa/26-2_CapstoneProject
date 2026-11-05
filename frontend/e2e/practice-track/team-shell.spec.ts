import {test,expect} from '@playwright/test';
test('team header and protected deep links host the practice module without a second application layout',async({page})=>{
 await page.goto('/practice/history');
 await expect(page.getByRole('heading',{name:'연습 기록',exact:true})).toBeVisible();
 await expect(page.locator('.site-header')).toBeVisible();
 await expect(page.locator('.feature-nav').getByRole('link',{name:'Practice',exact:true})).toBeVisible();
 await expect(page.locator('.practice-track')).toHaveCount(1);
 await expect(page.locator('main')).toHaveCount(1);
 await page.getByRole('link',{name:'지원 관리',exact:true}).click();
 await expect(page).toHaveURL(/\/track$/);await expect(page.getByRole('heading',{name:'지원 관리',exact:true})).toBeVisible();
 await expect(page.locator('.site-header')).toHaveCount(1);
});

test('dashboard stays independent and feature styles do not change the existing profile or header',async({page})=>{
 const featureRequests:string[]=[];
 page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/src/features/practice-track/'))featureRequests.push(request.url());});
 await page.route('**/rest/v1/profiles*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{archive:null}])}));
 await page.goto('/');await expect(page.getByRole('heading',{name:'Welcome to JobSeeker!',exact:true})).toBeVisible();
 expect(featureRequests).toHaveLength(0);
 const header=await page.locator('.site-header').evaluate(element=>getComputedStyle(element).backgroundColor);
 await page.locator('.dashboard-card[href="/practice"]').click();await expect(page.getByRole('heading',{name:'면접 연습',exact:true})).toBeVisible();
 expect(featureRequests.length).toBeGreaterThan(0);
 await page.locator('.feature-nav').getByRole('link',{name:'Profile',exact:true}).click();
 await expect(page.getByRole('heading',{name:'My Profile',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'기본정보',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())).toBe('');
 expect(await page.locator('.site-header').evaluate(element=>getComputedStyle(element).backgroundColor)).toBe(header);
 await expect(page.locator('.practice-track')).toHaveCount(0);
});
