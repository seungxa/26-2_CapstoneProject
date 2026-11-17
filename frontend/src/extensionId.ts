/** The JobSeeker Chrome extension's ID, fixed by the public key in extension/manifest.json. A different build can
 *  override it with VITE_EXTENSION_ID. No imports, so any module can use it */
export const EXTENSION_ID: string =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_EXTENSION_ID || 'hbbocccjbnobncagkalnkeapkndiompd'
