/** SDK-independent identity lifecycle: refresh keeps work, user changes discard it. */
export type HostSession = {user:{id:string}};
type SessionSource = {
 getSession:()=>Promise<{data:{session:HostSession|null};error?:unknown}>;
 onAuthStateChange:(callback:(event:string,session:HostSession|null)=>void)=>{data:{subscription:{unsubscribe:()=>void}}};
};
export function createHostSessionBridge(host:SessionSource,onIdentityChange:()=>void){
 let snapshot:{ready:boolean;userId:string|null;revision:number}={ready:false,userId:null,revision:0};
 let identity:string|null|undefined;
 let generation=0;
 let stopSource:(()=>void)|undefined;
 const listeners=new Set<()=>void>();
 function apply(session:HostSession|null){
  const next=session?.user.id??null;
  const changed=identity!==next;
  if(changed){onIdentityChange();identity=next;}
  if(!changed&&snapshot.ready)return;
  snapshot={ready:true,userId:next,revision:snapshot.revision+(changed?1:0)};
  for(const listener of listeners)listener();
 }
 function start(){
  const run=++generation;let events=0;
  const {data:{subscription}}=host.onAuthStateChange((_event,session)=>{
   if(generation!==run)return;events++;apply(session);
  });
  stopSource=()=>subscription.unsubscribe();
  const initial=events;
  host.getSession().then(({data,error})=>{
   if(generation===run&&events===initial)apply(error?null:data.session);
  }).catch(()=>{if(generation===run&&events===initial)apply(null);});
 }
 return {
  getSnapshot:()=>snapshot,
  subscribe:(listener:()=>void)=>{
   listeners.add(listener);if(listeners.size===1)start();
   return ()=>{
    listeners.delete(listener);
    if(!listeners.size){generation++;stopSource?.();stopSource=undefined;snapshot={...snapshot,ready:false};}
   };
  },
 };
}
