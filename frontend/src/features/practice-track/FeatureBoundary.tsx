import {useEffect,useState,useSyncExternalStore,type ReactNode} from 'react';
import {NavLink,Navigate,useLocation} from 'react-router';
import {hostSession} from './integration/host';
import {api} from './api';
import {serviceNotice} from './sttText';
import type {Health} from './types';
import './styles.css';

function ServiceStatus(){
 const [health,setHealth]=useState<Health|null>(null),[down,setDown]=useState(false);
 useEffect(()=>{let active=true;api.health().then(value=>{if(active)setHealth(value);}).catch(()=>{if(active)setDown(true);});return()=>{active=false;};},[]);
 return <>{down&&<p className="card err" role="alert">연습 서버에 연결할 수 없어요. 입력을 보관하고 잠시 후 다시 시도해 주세요.</p>}{health&&serviceNotice(health)&&<p className="card small muted">{serviceNotice(health)}</p>}</>;
}
export default function FeatureBoundary({children}:{children:ReactNode}){
 const session=useSyncExternalStore(hostSession.subscribe,hostSession.getSnapshot);
 const location=useLocation();
 if(!session.ready)return <p role="status">로그인 상태를 확인하고 있어요.</p>;
 if(!session.userId)return <Navigate to="/login" state={{from:location}} replace/>;
 return <div className="practice-track" lang="ko" key={session.revision}>
  <nav className="pt-nav" aria-label="면접 연습·지원 이력">
   <NavLink to="/practice" end>연습 시작</NavLink><NavLink to="/practice/history">연습 기록</NavLink><NavLink to="/practice/settings">녹음·개인정보</NavLink><NavLink to="/track" end>지원 관리</NavLink><NavLink to="/track/stats">통계</NavLink>
  </nav>
  <ServiceStatus/><div className="pt-content">{children}</div>
 </div>;
}
