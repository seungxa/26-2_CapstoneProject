// Exercises real MV3 messaging, storage, tab binding and the unpacked extension in a fresh browser profile.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const root = path.resolve(__dirname, '..');

async function main() {
  const server = http.createServer((req,res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1);
    if (!/^demo-[a-z]+\.(html|js)$/.test(name)) {res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',name.endsWith('js')?'text/javascript':'text/html;charset=utf-8');
    res.end(fs.readFileSync(path.join(root,name)));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let context;
  try {
    context = await chromium.launchPersistentContext('',{
      executablePath:process.env.CHROME_EXECUTABLE,headless:true,channel:process.env.PW_CHANNEL||undefined,
      ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--disable-features=DisableLoadExtensionCommandLineSwitch','--load-extension='+root]
    });
    const page = context.pages()[0];
    const cdp = await context.newCDPSession(page);
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:5000}).catch(()=>null);
    const id=worker?new URL(worker.url()).hostname:(await cdp.send('Extensions.loadUnpacked',{path:root})).id;
    const panel = await context.newPage();
    await panel.goto('chrome-extension://'+id+'/panel.html');
    await panel.evaluate(()=>chrome.storage.local.set({'jobseeker.archive.v1':{revision:1,profile:{
      name:'예시지원자',gender:'여성',phone:'010-1111-2222',address:'예시로 123',postcode:'00000',addressDetail:'501호',
      veteran:'대상 (5%)',veteranNumber:'123456'
    }}}));
    const url='http://127.0.0.1:'+server.address().port+'/demo-advanced.html';
    await page.goto(url);
    await page.bringToFront();
    const run=async()=>{
      await panel.evaluate(()=>document.querySelector('#stage').click());
      await panel.waitForFunction(()=>!document.querySelector('#stage').disabled,null,{timeout:50000});
      console.log(await panel.locator('#status').textContent());
      
    };
    let popups=0;page.on('popup',()=>popups++);
    await run();
    assert.equal(await page.locator('#detail-address').inputValue(),'501호');
    assert.equal(await page.locator('#base-address').inputValue(),'예시로 123');
    assert.equal(await page.locator('#zip').inputValue(),'00000');
    assert.equal(await page.locator('#p1').inputValue(),'1111');
    assert.equal(await page.locator('[value=F]').isChecked(),true);
    await page.locator('#korean-name').evaluate(el=>el.value='기존값');
    await page.locator('#base-address').evaluate(el=>{el.readOnly=false;el.id='legacyRoad';el.value='서울특별시 예시로 123 (예시동)';});
    await page.locator('#detail-address').evaluate(el=>el.value='');
    await run();
    assert.equal(popups,1);
    assert.equal(await page.locator('#detail-address').inputValue(),'501호');
    assert.equal(await page.locator('#korean-name').inputValue(),'기존값');
    assert.equal(await page.evaluate(()=>window.stageActions),0);
    // A second, non-table form reveals its dependent input when a radio is chosen.
    await page.evaluate(()=>{
      document.body.innerHTML='<form><fieldset><legend>취업지원대상자</legend><label><input type="radio" name="v">대상 (5%)</label><label><input type="radio" name="v">비대상</label></fieldset><label hidden id="number">보훈번호<input></label><label>비상연락처<input></label><div role="group" aria-label="성별"><button type="button" aria-pressed="false">남성</button><button type="button" aria-pressed="false">여성</button></div><button>다음</button></form>';
      for(const option of document.querySelectorAll('[aria-pressed]'))option.onclick=()=>option.setAttribute('aria-pressed','true');
      document.querySelector('fieldset').onchange=()=>document.querySelector('#number').hidden=false;
      document.querySelector('form').onsubmit=e=>{e.preventDefault();window.stageActions++};
    });
    await run();
    assert.equal(await page.locator('#number input').inputValue(),'123456');
    assert.equal(await page.getByRole('button',{name:'여성'}).getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('input').last().inputValue(),'');
    assert.equal(await page.evaluate(()=>window.stageActions),0);
    await panel.evaluate(async()=>{
      const key='jobseeker.archive.v1',data=(await chrome.storage.local.get(key))[key];
      Object.assign(data,{
        military:[{branch:'육군',start:'2020-03',end:'2021-09'}],
        language:[{exam:'OPIc',grade:'IH',number:'OP123'},{exam:'New TEPS',score:'400',number:'NT456'}],
        education:[{tier:'고등학교',school:'예시고'},{tier:'대학교',school:'예시대학교'}],
        license:[{credential:'정보처리기사',issuer:'예시기관',number:'EX01'}],
        experience:[{company:'예시기업',department:'기획부',status:'재직중'}]
      });await chrome.storage.local.set({[key]:data});
    });
    await page.evaluate(()=>{
      document.body.innerHTML=[
        '<section><h2>병역사항</h2><label>군별<select id="branch"><option></option><option>육군</option></select></label><table><tr><th>복무기간</th><td><input id="sy">년 <input id="sm">월 ~ <input id="ey">년 <input id="em">월</td></tr></table></section>',
        '<section><h2>외국어 활용 능력</h2><table><tr><th>시험명</th><th>점수</th><th>등록번호</th></tr><tr><td>New TEPS</td><td><input id="score"></td><td><input id="tepsNo"></td></tr><tr><td>OPIc</td><td></td><td><input id="opicNo"></td></tr></table></section>',
        '<section><h2>학력사항</h2><table><tr><th>고등학교</th><th>학교명</th><td><input id="hs"></td></tr><tr><th>대학교</th><th>학교명</th><td><input id="uni"></td></tr></table></section>',
        '<section><h2>자격증</h2><table><tr><th>자격증</th><td><input readonly id="cert"><button type="button" id="lookup">자격증검색</button></td><th>등록번호</th><td><input id="certNo"></td></tr></table></section>',
        '<section><h2>경력사항</h2><label>회사명<input id="company"></label><label>근무부서<input id="dept"></label><label>재직<input type="checkbox" id="currentJob"></label></section>',
        '<dialog id="catalog"><h2>자격증 검색</h2><input type="search"><button type="button" id="find">검색</button><div id="hits"></div></dialog>'
      ].join('');
      const dialog=document.querySelector('#catalog');
      document.querySelector('#lookup').onclick=()=>dialog.showModal();
      document.querySelector('#find').onclick=()=>{
        const hit=document.createElement('button');hit.type='button';hit.textContent='정보처리기사';
        hit.onclick=()=>{document.querySelector('#cert').value=hit.textContent;dialog.close();};
        document.querySelector('#hits').append(hit);
      };
    });
    await run();
    for(const [id,expected] of Object.entries({branch:'육군',sy:'2020',sm:'03',ey:'2021',em:'09',score:'400',tepsNo:'NT456',opicNo:'OP123',hs:'예시고',uni:'예시대학교',cert:'정보처리기사',certNo:'EX01',company:'예시기업',dept:'기획부'})){
      assert.equal(await page.locator('#'+id).inputValue(),expected,id+': '+await panel.locator('#results').innerText());
    }
    assert.equal(await page.locator('#currentJob').isChecked(),true);
    await panel.evaluate(async()=>{
      const k='jobseeker.archive.v1',a=(await chrome.storage.local.get(k))[k];
      a.education=[{tier:'대학교',school:'예시대학교',major:'전기전자공학',start:'2020-03',end:'2024-02'}];
      await chrome.storage.local.set({[k]:a});
    });
    await page.evaluate(()=>{
      const tiers=['고등학교','전문대학','대학교','편입대학교','대학원','구분미상'];
      const rows=tiers.map((tier,i)=>'<tr><th rowspan="3">'+tier+'</th><th>학교명</th><td><input id="school'+i+'"></td></tr><tr><th>기간</th><td><input>년 <input>월 입학 ~ <input>년 <input>월 졸업</td></tr><tr><th>전공</th><td><input readonly><button type="button">전공검색</button></td></tr>').join('');
      document.body.innerHTML='<section><h2>학력사항</h2><table>'+rows+'</table></section><dialog><h2>전공 검색</h2><p>예) 경영학--&gt;경영, 전기전자공학--&gt;전기</p><input type="search"><button type="button">검색</button><div></div></dialog>';
      const dialog=document.querySelector('dialog');
      document.querySelectorAll('td button').forEach(button=>button.onclick=()=>{window.majorInput=button.previousElementSibling;dialog.showModal();});
      dialog.querySelector('button').onclick=()=>{
        window.lastMajorTerm=dialog.querySelector('input').value;
        if(window.lastMajorTerm!=='전기')return;
        for(const name of ['전기공학','전기전자공학']){
          const item=document.createElement('button');item.type='button';item.textContent=name;
          item.onclick=()=>{window.majorInput.value=name;dialog.close();};dialog.querySelector('div').append(item);
        }
      };
    });
    await run();
    const data=await page.locator('table input').evaluateAll(inputs=>inputs.map(el=>el.value));
    const expected=Array(36).fill('');expected.splice(12,6,'예시대학교','2020','03','2024','02','전기전자공학');
    assert.deepEqual(data,expected);
    assert.equal(await page.evaluate(()=>window.lastMajorTerm),'전기');
    console.log('PASS: university-only archive leaves 30 controls in other/unknown tiers empty, uses the popup example and selects the full major name');
    await panel.evaluate(async()=>{
      const k='jobseeker.archive.v1',a=(await chrome.storage.local.get(k))[k];
      Object.assign(a.profile,{gender:'남성',email:'jobseeker.qa@example.invalid'});await chrome.storage.local.set({[k]:a});
    });
    await page.evaluate(()=>{
      document.body.innerHTML='<form><table><tr><td>국적 *</td><td><input type="radio" name="national" checked>내국인<input type="radio" name="national">외국인</td></tr><tr><td>성 별 *</td><td><input type="radio" name="sex" value="1">남자<input type="radio" name="sex" value="2">여자</td></tr><tr><td>Email 주소 *</td><td><input id="user" value="jobseeker.qa">@<input id="domain" disabled><select id="domains"><option value="0">도메인선택</option><option value="1">naver.com</option><option value="9">직접 입력</option></select></td></tr><tr><td>비밀번호</td><td><input type="password"></td></tr></table><button>확인</button></form>';
      const list=document.querySelector('#domains'),domain=document.querySelector('#domain');
      list.onchange=()=>{domain.disabled=list.value!=='9';domain.value=list.value==='1'?'naver.com':'';};
      document.querySelector('form').onsubmit=e=>{e.preventDefault();window.stageActions++};
    });
    await run();
    assert.equal(await page.locator('[name=sex]:checked').inputValue(),'1');
    assert.equal(await page.locator('#domains').inputValue(),'9');
    assert.equal(await page.locator('#domain').inputValue(),'example.invalid');
    assert.equal(await page.locator('#user').inputValue(),'jobseeker.qa');
    assert.equal(await page.locator('[type=password]').inputValue(),'');
    await page.evaluate(()=>{
      document.body.innerHTML='<fieldset><legend>성별</legend><label><input type="radio" name="sex2" value="2">여자</label><label><input type="radio" name="sex2" value="1">남자</label></fieldset><div class="field"><label for="local2">Email address</label><input id="local2">@<select id="provider"><option>선택</option><option value="89">example.invalid</option></select></div>';
    });
    await run();
    assert.equal(await page.locator('[name=sex2]:checked').inputValue(),'1');
    assert.equal(await page.locator('#local2').inputValue(),'jobseeker.qa');
    assert.equal(await page.locator('#provider').inputValue(),'89');
    assert.equal(await page.evaluate(()=>window.stageActions),0);
    console.log('PASS: split email with manual or preset domain, plain sibling or labelled radios');
    console.log('PASS: archive records, exam row and column, periods, catalog dialog');
    console.log('PASS: two layouts, conditional field, real address popup, repeat run, no stage action');
  } finally {if(context)await context.close();server.close();}
}
main().catch(err=>{console.error(err);process.exitCode=1;});
