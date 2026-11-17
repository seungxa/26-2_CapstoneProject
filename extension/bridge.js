// Messages from the JobSeeker web app (chrome.runtime.sendMessage(EXTENSION_ID, …)). Chrome already limits senders to
// manifest.externally_connectable.matches; the background checks the origin again and the message shape before
// storing anything. Pure functions only.
const MAX_TOKEN = 4096;

/** Is this page origin one of the manifest's externally_connectable patterns ("scheme://host[:port]/*")? */
export function allowedOrigin(origin, manifest) {
  if (typeof origin !== 'string') return false;
  return (manifest?.externally_connectable?.matches ?? []).some((pattern) => {
    const m = /^(https?:\/\/[^/*]+)\/\*$/.exec(pattern);
    return m !== null && m[1] === origin;
  });
}

/** {kind:'ping'} | {kind:'session', token} | {kind:'archive', archive} | {error} */
export function parseExternal(message) {
  if (!message || typeof message !== 'object') return { error: 'Not a JobSeeker message.' };
  if (message.type === 'jobseeker:ping') return { kind: 'ping' };
  if (message.type === 'jobseeker:session') {
    const { token } = message;
    if (token === null) return { kind: 'session', token: null };
    if (typeof token !== 'string' || !token || token.length > MAX_TOKEN) return { error: 'The sign-in token is not valid.' };
    return { kind: 'session', token };
  }
  if (message.type === 'jobseeker:archive') {
    const { archive } = message;
    if (!archive || typeof archive !== 'object' || Array.isArray(archive)) return { error: 'Not a valid archive.' };
    return { kind: 'archive', archive };
  }
  return { error: 'Not a JobSeeker message.' };
}
