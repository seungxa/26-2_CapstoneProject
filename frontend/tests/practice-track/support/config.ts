import {randomBytes,createHmac} from 'node:crypto';
process.env.PRACTICE_TRACK_TEST_JWT_SECRET??=randomBytes(48).toString('hex');
export const jwtSecret=process.env.PRACTICE_TRACK_TEST_JWT_SECRET;
export const authUrl='http://127.0.0.1:8022';
export const userA='00000000-0000-0000-0000-000000000001';
export function sessionFor(userId=userA){
 const now=Math.floor(Date.now()/1000),encode=(x:unknown)=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const body=encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:userId,aud:'authenticated',iss:authUrl+'/auth/v1',role:'authenticated',iat:now,exp:now+7200});
 return {access_token:body+'.'+createHmac('sha256',jwtSecret).update(body).digest('base64url'),refresh_token:'fixture-'+userId,expires_at:now+7200,expires_in:7200,token_type:'bearer',user:{id:userId,aud:'authenticated',role:'authenticated',email:'practice@example.invalid',app_metadata:{provider:'email',providers:['email']},user_metadata:{}}};
}
export function storageFor(origin='http://localhost:5179'){
 return {cookies:[],origins:[{origin,localStorage:[{name:'sb-127-auth-token',value:JSON.stringify(sessionFor())}]}]};
}
export const authServer={command:'../backend/.venv/bin/python tests/practice-track/support/auth_fixture.py --port 8022',url:authUrl+'/health',reuseExistingServer:false,env:{PRACTICE_TRACK_TEST_JWT_SECRET:jwtSecret}};
export const frontendAuthEnv={VITE_SUPABASE_URL:authUrl,VITE_SUPABASE_PUBLISHABLE_KEY:'local-publishable-fixture'};
