import {lazy,Suspense} from 'react';
const PracticeFeature=lazy(()=>import('../features/practice-track/routes').then(module=>({default:module.PracticeFeature})));
export default function Practice(){return <Suspense fallback={<p role="status">면접 연습을 불러오는 중…</p>}><PracticeFeature/></Suspense>;}
