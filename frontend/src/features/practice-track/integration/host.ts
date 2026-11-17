import {supabase} from '../../../lib/supabase';
import {api,configureApiClient} from '../api';
import {createHostSessionBridge} from './session';
import {sendSession} from './extensionBridge';

// The existing team singleton owns tokens, persistence and refresh.
configureApiClient({
 baseUrl:import.meta.env.VITE_API_URL,
 getAccessToken:async()=>{const {data,error}=await supabase.auth.getSession();if(error)throw error;return data.session?.access_token??null;},
 onUnauthorized:async()=>{const {error}=await supabase.auth.refreshSession();if(error)throw error;},
});
export const hostSession=createHostSessionBridge({
 getSession:()=>supabase.auth.getSession(),
 onAuthStateChange:callback=>supabase.auth.onAuthStateChange(callback),
},()=>api.resetSession());

// Keep identity cleanup active after navigating to a team-owned page.
// One module-owned listener; HMR disposes it instead of accumulating subscriptions.
const stopIdentityCleanup=hostSession.subscribe(()=>{});
if(import.meta.hot)import.meta.hot.dispose(stopIdentityCleanup);

// Hand the sign-in token to the JobSeeker extension when it signs in, refreshes or signs out (no-op without it).
supabase.auth.getSession().then(({data})=>{if(data.session)void sendSession(data.session.access_token);}).catch(()=>{});
const {data:{subscription:extensionAuth}}=supabase.auth.onAuthStateChange((_event,session)=>{void sendSession(session?.access_token??null);});
if(import.meta.hot)import.meta.hot.dispose(()=>extensionAuth.unsubscribe());
