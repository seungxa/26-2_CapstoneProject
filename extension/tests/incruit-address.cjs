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
    await ctx.route(opener,r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<form name="applyform"><table><tr><th>자격증</th><td><input name="License" readonly></td><th>발행처</th><td><input readonly name="LicenseOrg"></td><th>등록번호</th><td><input name="LicenseNumber"></td></tr><tr><th>현주소</th><td><input readonly id="zip"><button type="button" id="lookup">주소검색</button><input readonly id="road"><input id="detail"></td></tr></table></form>'}));
    await page.goto(opener);await page.bringToFront();
    await page.evaluate(()=>{document.querySelector('#lookup').onclick=()=>window.open('/_lc/popup/popup_roadsearch.asp?zip=zip&addr=road&addrdet=detail','search','popup');});
    await page.locator('[name=License]').evaluate(el=>el.onclick=()=>window.open('/_lc/popup/popup_searchlicensecd.asp?pjtid=101&depart=106&elemid=0','license','popup'));
    panel.on('dialog',dialog=>dialog.accept());
    await panel.locator('#import').setInputFiles(path.resolve(root,'../../JobSeeker-가상지원자-전체예시.json'));
    await panel.getByText('가져오기 완료',{exact:true}).waitFor();
    await page.bringToFront();
    let opens=0;page.on('popup',p=>{opens++;p.on('requestfailed',r=>console.log('request failed',new URL(r.url()).hostname,r.failure()?.errorText));});
    const run=async()=>{
      await panel.locator('#stage').evaluate(b=>b.click());
      await panel.waitForFunction(()=>!document.querySelector('#stage').disabled,null,{timeout:45000});
    };
    await run();
    console.log(await panel.locator('#results').innerText());
    const popup=ctx.pages().find(p=>p.url().includes('popup_roadsearch.asp'));
    if(popup)console.log(await popup.evaluate(()=>({visible:document.body.innerText.slice(-700),rows:document.querySelectorAll('.load_lay tr').length,ids:[...document.querySelectorAll('input,button')].map(e=>[e.id,e.value]).slice(0,30)})));
    assert.equal(await page.locator('[name=License]').inputValue(),'정보처리기사');
    assert.equal(await page.locator('[name=LicenseOrg]').inputValue(),'한국산업인력공단');
    assert.equal(await page.locator('[name=LicenseNumber]').inputValue(),'TEST-CERT-001');
    assert.equal(await page.locator('#zip').inputValue(),'04524');
    assert.match(await page.locator('#road').inputValue(),/세종대로 110/);
    assert.equal(await page.locator('#detail').inputValue(),'테스트용 가상동 101호');
    await page.locator('#zip').focus();
    await run();assert.equal(opens,2);
    console.log('PASS: real Incruit popup closed with matching address and detail; focus return and repeated fill opened no additional popup');
  }finally{await ctx.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
