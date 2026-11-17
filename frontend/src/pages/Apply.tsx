import { lazy, Suspense } from 'react'
// Keeps the Chrome extension's sign-in in step with this site on every page (small; no feature code)
import '../extensionSession'

// The Apply page lives with the Practice·Track feature code and loads only when this page opens
const ApplyPage = lazy(() => import('../features/practice-track/pages/ApplyPage'))

function Apply() {
  return <Suspense fallback={<p role="status">Loading…</p>}><ApplyPage /></Suspense>
}

export default Apply
