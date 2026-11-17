// Live public lookup with a synthetic opener. No employer application is loaded.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
  const root=path.join(__dirname,'..');
  const ctx=await chromium.launchPersistentContext('',{headless:true,executablePath:process.env.CHROME_EXECUTABLE,
    ignoreDefaultArgs:['--disable-extensions'],args:['--load-extension='+root,'--enable-unsafe-extension-debugging']});
  try{
    const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
    const panel=await ctx.newPage();
    await panel.goto('chrome-extension://'+new URL(worker.url()).host+'/panel.html');
    const page=ctx.pages()[0],origin='https://suhyup.incruit.com';
    const opener=origin+'/jobseeker-local-fixture';
    await ctx.route(opener,r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<table><tr><th>전문대학</th><th>입학년월</th><td><input id="collegeDate"></td></tr><tr><th rowspan="2">대학교</th><th>입학년월</th><td><input id="uniDate"></td></tr><tr><th>전공</th><td><input id="UniversityMajor" readonly></td></tr></table>'}));
    await page.goto(opener);
    await page.locator('#UniversityMajor').evaluate(el=>el.onclick=()=>window.open('/_lc/popup/popup_searchschool.asp?maincd=Major&elemid=UniversityMajor','major','popup'));
    const observed=[];
    ctx.on('request',r=>{if(/Popup_Searchschool_AJAX\.asp/i.test(r.url()))observed.push([r.url(),r.postData()]);});
    for(const [major,keyword] of [['경영학','경영'],['전기전자공학','전기']]){
      await panel.evaluate(major=>chrome.storage.local.set({'jobseeker.archive.v1':{revision:1,education:[{tier:'대학교',major,start:'2020-03'}]}}),major);
      await page.locator('#UniversityMajor').evaluate(el=>el.value='');
      await page.bringToFront();observed.length=0;
      await panel.locator('#stage').evaluate(b=>b.click());
      await panel.waitForFunction(()=>!document.querySelector('#stage').disabled,null,{timeout:35000});
      console.log(await panel.locator('#results').innerText());

      assert.equal(await page.locator('#UniversityMajor').inputValue(),major);
      assert.equal(await page.locator('#collegeDate').inputValue(),'');
      assert.equal(await page.locator('#uniDate').inputValue(),'2020-03');
      assert.ok(observed.some(([,body])=>body?.split('&').includes('Sch_Nm='+escape(keyword))));
      console.log('PASS: '+major);
    }
  }finally{await ctx.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
