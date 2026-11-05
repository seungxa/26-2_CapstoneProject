import {lazy,Suspense} from 'react';
const TrackFeature=lazy(()=>import('../features/practice-track/routes').then(module=>({default:module.TrackFeature})));
export default function Track(){return <Suspense fallback={<p role="status">지원 이력을 불러오는 중…</p>}><TrackFeature/></Suspense>;}
