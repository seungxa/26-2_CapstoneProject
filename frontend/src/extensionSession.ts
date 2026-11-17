// Keeps the JobSeeker Chrome extension signed in as the same user as this site: sends the Supabase access token on
// sign-in and refresh, and null on sign-out, from any page. Loaded by pages/Apply.tsx, which the app always imports.
// Kept outside src/features so the dashboard still loads no feature code. Without the extension nothing happens.
import { supabase } from './lib/supabase'

import { EXTENSION_ID } from './extensionId'

type Runtime = { sendMessage: (id: string, message: unknown, callback: (reply: unknown) => void) => void; lastError?: unknown }

function sendToken(token: string | null) {
  const runtime = (globalThis as { chrome?: { runtime?: Runtime } }).chrome?.runtime
  if (!runtime?.sendMessage) return
  try {
    runtime.sendMessage(EXTENSION_ID, { type: 'jobseeker:session', token }, () => { void runtime.lastError })
  } catch { /* extension not installed */ }
}

if (typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange((_event, session) => sendToken(session?.access_token ?? null))
}
