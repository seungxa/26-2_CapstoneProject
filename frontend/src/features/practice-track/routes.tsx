import {lazy,Suspense} from 'react';
import {Route,Routes} from 'react-router';
import FeatureBoundary from './FeatureBoundary';
import PracticeHome from './pages/PracticeHome';
import SessionList from './pages/SessionList';
import SessionRunner from './pages/SessionRunner';
import SessionReview from './pages/SessionReview';
import PracticeSettings from './pages/PracticeSettings';
import TrackList from './pages/TrackList';
import ApplicationPage from './pages/ApplicationPage';
import StatsPage from './pages/StatsPage';
import {GAZE_LAB} from './video/debug';
const GazeLab=GAZE_LAB?lazy(()=>import('./pages/GazeLab')):null;
export function PracticeFeature(){return <FeatureBoundary><Routes>
 <Route index element={<PracticeHome/>}/><Route path="history" element={<SessionList/>}/><Route path="settings" element={<PracticeSettings/>}/>
 <Route path="sessions/:id/run" element={<SessionRunner/>}/><Route path="sessions/:id" element={<SessionReview/>}/>
 {GazeLab&&<Route path="dev/gaze-lab" element={<Suspense fallback={<p>불러오는 중…</p>}><GazeLab/></Suspense>}/>}
</Routes></FeatureBoundary>;}
export function TrackFeature(){return <FeatureBoundary><Routes>
 <Route index element={<TrackList/>}/><Route path="stats" element={<StatsPage/>}/><Route path=":id" element={<ApplicationPage/>}/>
</Routes></FeatureBoundary>;}
