import { injectIntoTab } from './tab-connection.js';
import { loadSettings, isReady, pickCandidate } from './llm.js';
// Like the working PoC: start the connection from the actual toolbar event,
// while keeping the existing side panel UI. Known hosts have persistent access.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);
chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
  injectIntoTab(chrome, tab).then(() => {
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#24644e' });
    chrome.action.setBadgeText({ tabId: tab.id, text: 'ON' });
    if(tab.openerTabId)bindAddress(tab.id,tab.openerTabId);
  }).catch(async error => {
    await chrome.storage.session.set({ [`connection_${tab.id}`]: error.message });
    chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
  });
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
});
const recentChildren=new Map();
chrome.tabs.onCreated.addListener(tab=>{if(tab.openerTabId)recentChildren.set(tab.id,{opener:tab.openerTabId,created:Date.now()});});
chrome.webNavigation.onCreatedNavigationTarget.addListener(({sourceTabId,sourceFrameId,tabId})=>{
  recentChildren.set(tabId,{opener:sourceTabId,sourceFrameId,created:Date.now()});
  chrome.tabs.get(tabId).then(tab=>{if(tab.status==='complete')return bindAddress(tabId,sourceTabId);}).catch(()=>{});
});
async function bindAddress(tabId,opener) {
  const intent=(await chrome.storage.session.get(`address_${opener}`))[`address_${opener}`];
  if(!intent||Date.now()-intent.created>(intent.ttl||35000))return;
  const record=recentChildren.get(tabId);
  if(!record || record.opener!==opener || record.created<intent.created)return;
  if(record.sourceFrameId!==undefined && record.sourceFrameId!==intent.frameId)return;
  if(intent.childId && intent.childId!==tabId)return;
  intent.childId=tabId;
  await chrome.storage.session.set({[`address_${opener}`]:intent});
  try {
    const results=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},files:['values.js','widgets.js','address-agent.js']});
    const tab=await chrome.tabs.get(tabId);
    const url=new URL(tab.url);
    if(!/(^|\.)incruit\.com$/i.test(url.hostname)||!/^\/_lc\/popup\/popup_roadsearch\.asp$/i.test(url.pathname))delete intent.detail;
    for(const frame of results)await chrome.tabs.sendMessage(tabId,{type:'JS_ADDRESS_CONTEXT',intent,child:true},{frameId:frame.frameId}).catch(()=>{});
  }catch(error){
    const current=await chrome.tabs.get(tabId).catch(()=>null);
    // Still loading (about:blank): the onUpdated "complete" event binds again, so stay quiet.
    if(!current||current.status!=='complete'||!/^https?:/.test(current.url||''))return;
    const message=/permission|cannot access/i.test(error.message)?'Allow site access for the search popup.':'Could not connect to the search popup.';
    chrome.runtime.sendMessage({type:'JS_NOTICE',message,warn:true}).catch(()=>{});
  }
}
// A named popup window (window.open(url,"SearchLicenseWin")) is reused by the next search:
// treat each new page load in it as a fresh child.
chrome.webNavigation.onCommitted.addListener(({tabId,frameId})=>{const record=recentChildren.get(tabId);if(frameId===0&&record)record.created=Date.now();});
chrome.tabs.onUpdated.addListener((id,change,tab)=>{if(change.status==='complete'&&(tab.openerTabId||recentChildren.has(id)))bindAddress(id,tab.openerTabId||recentChildren.get(id).opener);});
chrome.tabs.onRemoved.addListener(id=>{recentChildren.delete(id);chrome.storage.session.remove(`address_${id}`);});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(message.type==='JS_RESUME_ADDRESS'&&!sender.tab){
    chrome.tabs.get(message.tabId).then(tab=>tab.openerTabId?bindAddress(tab.id,tab.openerTabId):null).then(()=>respond({ok:true})).catch(error=>respond({error:error.message}));return true;
  }
  // Did the search popup open? If the browser blocked it, keep the search armed for the user's own click.
  if(message.type==='JS_CHILD_SINCE'&&sender.tab?.id){
    (async()=>{
      const opened=[...recentChildren.values()].some(r=>r.opener===sender.tab.id&&r.created>=message.since);
      if(!opened&&message.extend){
        const key=`address_${sender.tab.id}`;
        const intent=(await chrome.storage.session.get(key))[key];
        if(intent&&intent.created===message.created){intent.ttl=180000;await chrome.storage.session.set({[key]:intent});}
      }
      return {opened};
    })().then(respond).catch(()=>respond({opened:false}));return true;
  }
  if(message.type==='JS_LLM_PICK'&&sender.tab?.id){
    (async()=>{
      const now=Date.now();
      while(pickLog.length&&now-pickLog[0]>60000)pickLog.shift();
      if(pickLog.length>=40)return {index:-1,error:'AI limit reached (40/min).'};
      const settings=await loadSettings();
      if(!isReady(settings))return {index:-1};
      if(typeof message.query!=='string'||message.query.length>300||!Array.isArray(message.candidates)||message.candidates.some(c=>typeof c!=='string'))return {index:-1};
      pickLog.push(now);
      const result=await pickCandidate({query:message.query,label:String(message.label||'').slice(0,80),candidates:message.candidates},settings);
      // The AI never chooses by itself: it recommends, the user picks in the list or popup.
      if(result.index>=0)chrome.runtime.sendMessage({type:'JS_NOTICE',warn:true,message:'AI suggests: "'+message.query+'" → "'+message.candidates[result.index]+'"'+(result.reason?' ('+result.reason+')':'')+' — pick it in the list.'}).catch(()=>{});
      return {index:-1,recommended:result.index};
    })().then(respond).catch(error=>respond({index:-1,error:error.message}));return true;
  }
  if(message.type==='JS_ADDRESS_ARM'&&sender.tab?.id){
    (async()=>{
      if(typeof message.query!=='string'||!message.query.trim()||message.query.length>300)throw Error('Check the address.');
      const topic=message.topic||'address';
      if(!['address','school','major','credential','generic'].includes(topic))throw Error('Unsupported search.');
      const terms=Array.isArray(message.terms)?message.terms.filter(t=>typeof t==='string'&&t.trim()&&t.length<=100).slice(0,6):[];
      const extras=message.extras&&typeof message.extras==='object'?Object.fromEntries(Object.entries(message.extras).filter(([k,v])=>typeof k==='string'&&typeof v==='string'&&k.length<=20&&v&&v.length<=60).slice(0,6)):undefined;
      const intent={topic,terms,extras,label:String(message.label||'').slice(0,60),issuer:message.issuer,index:message.index,fieldId:message.fieldId,postcode:message.postcode||'',detail:message.detail||'',query:message.query,frameId:sender.frameId||0,created:Date.now()};
      await chrome.storage.session.set({[`address_${sender.tab.id}`]:intent});
      searches.set(intent.created,{tabId:sender.tab.id,frameId:sender.frameId||0});
      await chrome.tabs.sendMessage(sender.tab.id,{type:'JS_ADDRESS_CONTEXT',intent,child:false},{frameId:sender.frameId||0}).catch(()=>{});

      return {ok:true,created:intent.created};
    })().then(respond).catch(error=>respond({error:error.message}));return true;
  }
  // The search helper (popup window, layer or iframe) reports back to the form's frame.
  if(message.type==='JS_SEARCH_DONE'&&sender.tab?.id){
    const route=searches.get(message.created);
    if(route)chrome.tabs.sendMessage(route.tabId,{type:'JS_SEARCH_DONE',created:message.created,ok:Boolean(message.ok),message:String(message.message||'').slice(0,200),
      review:Boolean(message.review),picked:String(message.picked||'').slice(0,120),score:typeof message.score==='number'?message.score:null,
      others:Array.isArray(message.others)?message.others.filter(o=>typeof o==='string').slice(0,3).map(o=>o.slice(0,120)):[]},{frameId:route.frameId}).catch(()=>{});
    respond({ok:true});
  }
});
const searches=new Map();

const pickLog=[];
// Search layers often load their own iframe (e.g. a postcode or school finder) after the
// button is pressed. Connect only those that appear during a fresh search request.
chrome.webNavigation.onCompleted.addListener(async ({tabId,frameId,url})=>{
  if(frameId===0||!/^https?:/.test(url||''))return;
  const intent=(await chrome.storage.session.get(`address_${tabId}`))[`address_${tabId}`];
  if(!intent||Date.now()-intent.created>(intent.ttl||35000)||intent.topic==='address'&&!/postcode|juso|zip|addr/i.test(url))return;
  try{
    await chrome.scripting.executeScript({target:{tabId,frameIds:[frameId]},files:['values.js','widgets.js','address-agent.js']});
    await chrome.tabs.sendMessage(tabId,{type:'JS_ADDRESS_CONTEXT',intent,child:true},{frameId});
  }catch{}
});
