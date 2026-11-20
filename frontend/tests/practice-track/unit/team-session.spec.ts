import {test,expect} from '@playwright/test';
import {createHostSessionBridge,type HostSession} from '../../../src/features/practice-track/integration/session';
const session=(id:string):HostSession=>({user:{id}});
function host() {
 let emit: (event:string,value:HostSession|null)=>void=()=>{};
 const requests: {resolve:(value:{data:{session:HostSession|null},error?:unknown})=>void,reject:(error:Error)=>void}[]=[];
 let stops=0;
 return {requests,get stops(){return stops;},emit:(event:string,value:HostSession|null)=>emit(event,value),
  source:{getSession:()=>new Promise<{data:{session:HostSession|null},error?:unknown}>((resolve,reject)=>requests.push({resolve,reject})),
   onAuthStateChange:(callback:typeof emit)=>{emit=callback;return {data:{subscription:{unsubscribe:()=>{stops++;}}}};}}};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
test('a later auth event wins over an older initial session response',async()=>{
 const h=host();let resets=0;const bridge=createHostSessionBridge(h.source,()=>resets++);
 const stop=bridge.subscribe(()=>{});expect(bridge.getSnapshot().ready).toBe(false);
 h.emit('SIGNED_IN',session('B'));const b=bridge.getSnapshot();
 h.requests[0].resolve({data:{session:session('A')}});await flush();
 expect(bridge.getSnapshot()).toBe(b);expect(b.userId).toBe('B');expect(resets).toBe(1);stop();
});
test('refresh preserves current work while signout and user switch advance its identity key',()=>{
 const h=host();let resets=0;const bridge=createHostSessionBridge(h.source,()=>resets++);
 const stop=bridge.subscribe(()=>{});h.emit('INITIAL_SESSION',session('A'));const a=bridge.getSnapshot();
 h.emit('TOKEN_REFRESHED',session('A'));expect(bridge.getSnapshot()).toBe(a);expect(resets).toBe(1);
 h.emit('SIGNED_OUT',null);h.emit('SIGNED_IN',session('B'));
 expect(bridge.getSnapshot()).toMatchObject({userId:'B',ready:true,revision:a.revision+2});expect(resets).toBe(3);stop();
});
test('unmount hides cached identity and ignores late callbacks until a fresh subscription resolves',async()=>{
 const h=host();let resets=0;const bridge=createHostSessionBridge(h.source,()=>resets++);
 let stop=bridge.subscribe(()=>{});h.emit('INITIAL_SESSION',session('A'));const revision=bridge.getSnapshot().revision;
 stop();expect(bridge.getSnapshot().ready).toBe(false);expect(h.stops).toBe(1);
 h.emit('SIGNED_IN',session('old'));h.requests[0].resolve({data:{session:session('old')}});await flush();
 expect(bridge.getSnapshot()).toMatchObject({userId:'A',revision,ready:false});
 stop=bridge.subscribe(()=>{});h.requests[1].resolve({data:{session:session('B')}});await flush();
 expect(bridge.getSnapshot()).toMatchObject({userId:'B',ready:true,revision:revision+1});expect(resets).toBe(2);stop();
});
test('an unavailable initial session resolves to signed out rather than rendering stale protected data',async()=>{
 const h=host();const bridge=createHostSessionBridge(h.source,()=>{});const stop=bridge.subscribe(()=>{});
 h.requests[0].reject(new Error('offline'));await flush();expect(bridge.getSnapshot()).toMatchObject({ready:true,userId:null});stop();
});
