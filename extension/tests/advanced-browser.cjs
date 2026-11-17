const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
  const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await chromium.launch({...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),headless:true});
    const context=await browser.newContext(),page=await context.newPage(),panel=await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/demo-advanced.html`);
    await page.evaluate(()=>{
      window.addressQuery=null;
      window.chrome={runtime:{id:'test',async sendMessage(data){if(data.type==='JS_ADDRESS_ARM'){window.addressQuery=data.query;return {ok:true};}if(window.deliver)await window.deliver(data);},onMessage:{addListener(fn){window.contentListener=fn;}}}};
      window.command=data=>new Promise(resolve=>window.contentListener(data,{id:'test'},resolve));
    });
    for(const file of ['values.js','widgets.js','content.js'])await page.addScriptTag({path:path.join(root,file)});
    const call=data=>page.evaluate(data=>window.command(data),data);
    await panel.exposeFunction('bridgeSend',data=>call(data));
    const sample={revision:1,profile:{name:'테스트지원자',nameHanja:'試驗',birth:'2000-02-29',gender:'여성',phone:'010-1234-5678',emergencyPhone:'02-123-4567',address:'예시로 123',addressDetail:'501호'},education:[],experience:[],activity:[],award:[]};
    await panel.addInitScript(({sample,url})=>{const store={'jobseeker.archive.v1':sample},listeners=[];window.chrome={runtime:{id:'test',onMessage:{addListener(fn){listeners.push(fn);}},async sendMessage(){return {ok:true};}},storage:{local:{async get(){return store;},async set(data){Object.assign(store,data);},async remove(key){delete store[key];}}},tabs:{async query(){return [{id:9,url}];},async sendMessage(id,data){return window.bridgeSend(data);}},scripting:{async executeScript(){return [{result:{url}}];}}};window.target=data=>listeners.forEach(fn=>fn(data,{id:'test',tab:{id:9},frameId:0}));},{sample,url:page.url()});
    const inferenceRequests=[];context.on('request',request=>{if(/:(8766|11434)\//.test(request.url()))inferenceRequests.push(request.url());});
    await panel.goto(`http://127.0.0.1:${server.address().port}/panel.html`);
    await page.exposeFunction('deliver',data=>panel.evaluate(data=>window.target(data),data));
    async function clickAndWait(selector,done){await page.locator(selector).click({position:{x:5,y:5}});await done();}
    await clickAndWait('#p1',()=>page.waitForFunction(()=>document.getElementById('p1').value==='1234'&&document.getElementById('p2').value==='5678'));
    assert.equal(await page.locator('#p0').inputValue(),'010');assert.equal(await page.locator('#e1').inputValue(),'');
    await clickAndWait('#e1',()=>page.waitForFunction(()=>document.getElementById('e0').value==='02'&&document.getElementById('e1').value==='123'&&document.getElementById('e2').value==='4567'));
    await clickAndWait('#by',()=>page.waitForFunction(()=>document.getElementById('by').value==='2000'&&document.getElementById('bm').value==='02'&&document.getElementById('bd').value==='29'));
    await clickAndWait('#gender-group',()=>page.waitForFunction(()=>document.querySelector('[name=gender][value=F]').checked));
    await clickAndWait('#hanja-name',()=>page.waitForFunction(()=>document.getElementById('hanja-name').value==='試驗'));
    await clickAndWait('#custom-gender',()=>page.waitForFunction(()=>document.getElementById('custom-gender').textContent==='女性'||document.getElementById('custom-gender').textContent==='여성'));
    assert.equal(await page.evaluate(()=>window.stageActions),0);
    console.log('PASS: default automatic phone/date groups, radio gender, Hanja name, scoped custom selection; no application stage actions');
    await clickAndWait('#unknown-birth input:first-child',()=>page.waitForFunction(()=>[...document.querySelectorAll('#unknown-birth input')].map(el=>el.value).join('-')==='2000-02-29'));
    await page.evaluate(()=>{const table=document.createElement('table');table.innerHTML='<tr><th>수신용 정보 코드</th><td><input id="opaque"></td></tr>';document.body.append(table);});
    await page.locator('#opaque').click();
    await panel.getByText('수신용 정보 코드: 규칙으로 판단하지 못했습니다. 아카이브 항목을 직접 연결하거나 사이트에서 입력하세요.',{exact:true}).waitFor();
    assert.equal(await page.locator('#opaque').inputValue(),'');
    await panel.locator('#fields select').selectOption('profile.0.name');
    await page.waitForFunction(()=>document.getElementById('opaque').value==='테스트지원자');
    await page.locator('#opaque').evaluate(el=>el.value='');
    await page.locator('#opaque').click();
    await page.waitForFunction(()=>document.getElementById('opaque').value==='테스트지원자');
    console.log('PASS: DOB recognized by rules; unknown left blank; manual source mapping learned per site');
    const popupPromise=context.waitForEvent('page');
    await page.locator('#zip').click();
    const popup=await popupPromise;await popup.waitForLoadState();
    assert.equal(await page.evaluate(()=>window.addressQuery),'예시로 123');
    await popup.evaluate(()=>{window.listeners=[];window.chrome={runtime:{id:'test',async sendMessage(data){return {ok:true};},onMessage:{addListener(fn){window.listeners.push(fn);}}}};});
    for(const file of ['values.js','address-agent.js'])await popup.addScriptTag({path:path.join(root,file)});
    await popup.evaluate(()=>window.listeners.forEach(fn=>fn({type:'JS_ADDRESS_CONTEXT',intent:{query:'예시로 123'},child:true},{id:'test'},()=>{})));
    await page.waitForFunction(()=>document.getElementById('base-address').value==='예시로 123');
    assert.equal(await page.evaluate(()=>window.stageActions),0);assert.equal(await page.locator('#detail-address').inputValue(),'');
    await clickAndWait('#detail-address',()=>page.waitForFunction(()=>document.getElementById('detail-address').value==='501호'));
    for(const type of ['JS_CLICK','JS_ACTIONS','JS_SCAN'])assert.ok((await call({type})).error);
    assert.equal(inferenceRequests.length,0);
    console.log('PASS: zero inference requests; user-selected address -> separate popup query/search/exact result -> original form address; no next/save/confirm/submit');
  }finally{if(browser)await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
