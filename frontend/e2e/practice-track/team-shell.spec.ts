import {test,expect} from '@playwright/test';
test('team header and protected deep links host the practice module without a second application layout',async({page})=>{
 await page.goto('/practice/history');
 await expect(page.getByRole('heading',{name:'연습 기록',exact:true})).toBeVisible();
 await expect(page.locator('.site-header')).toBeVisible();
 await expect(page.locator('.feature-nav').getByRole('link',{name:'Practice',exact:true})).toBeVisible();
 await expect(page.locator('.practice-track')).toHaveCount(1);
 await expect(page.locator('main')).toHaveCount(1);
 await page.locator('.feature-nav').getByRole('link',{name:'Track',exact:true}).click();
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
 await expect(menu.getByRole('link')).toHaveText(['Applications','Stats']);
 await page.waitForLoadState('networkidle');
 await expect(feature.locator(':scope > *')).toHaveCount(2);
 await menu.getByRole('link',{name:'Stats',exact:true}).click();
 await expect(page).toHaveURL(/\/track\/stats$/);
});
