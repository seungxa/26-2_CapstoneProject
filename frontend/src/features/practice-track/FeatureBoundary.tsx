import {useEffect,useState,useSyncExternalStore,type ReactNode} from 'react';
import {NavLink,Navigate,useLocation} from 'react-router';
import {hostSession} from './integration/host';
import {api} from './api';
import './styles.css';

type Section='practice'|'track';
/** Each team tab shows only its own pages. `end` keeps the first link from staying active on its subpages */
const MENU:Record<Section,{to:string;label:string;end?:boolean}[]>={
 practice:[{to:'/practice',label:'Start',end:true},{to:'/practice/history',label:'History'},{to:'/practice/settings',label:'Settings'}],
 track:[{to:'/track',label:'Applications',end:true},{to:'/track/stats',label:'Stats'}],
};

/** Shown only when the practice server can't be reached. Transcription status lives next to the record button instead */
function ServerDown(){
 const [down,setDown]=useState(false);
 useEffect(()=>{let active=true;api.health().catch(()=>{if(active)setDown(true);});return()=>{active=false;};},[]);
 return down?<p className="card err" role="alert">Can't reach the practice server. Keep this page open and try again in a moment.</p>:null;
}
export default function FeatureBoundary({section,children}:{section:Section;children:ReactNode}){
 const session=useSyncExternalStore(hostSession.subscribe,hostSession.getSnapshot);
 const location=useLocation();
 if(!session.ready)return <p role="status">Checking your sign-in…</p>;
 if(!session.userId)return <Navigate to="/login" state={{from:location}} replace/>;
 return <div className="practice-track" lang="en" key={session.revision}>
  <nav className="pt-nav" aria-label={section==='practice'?'Practice menu':'Track menu'}>
   {MENU[section].map(item=><NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>)}
  </nav>
  <ServerDown/><div className="pt-content">{children}</div>
 </div>;
}
