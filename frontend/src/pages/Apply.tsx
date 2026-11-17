import { lazy, Suspense } from 'react'

// The Apply page lives with the Practice·Track feature code and loads only when this page opens
const ApplyPage = lazy(() => import('../features/practice-track/pages/ApplyPage'))

function Apply() {
  return <Suspense fallback={<p role="status">Loading…</p>}><ApplyPage /></Suspense>
}

export default Apply
