import {defineConfig,devices} from '@playwright/test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isolatedTemporaryDirectory} from './e2e/practice-track/isolation';
import {authServer,authUrl,jwtSecret,storageFor,frontendAuthEnv} from './tests/practice-track/support/config';
const data=isolatedTemporaryDirectory(mkdtempSync(join(tmpdir(),'jobseeker-team-auth-db-'))),recordings=isolatedTemporaryDirectory(mkdtempSync(join(tmpdir(),'jobseeker-team-auth-recordings-')));
export default defineConfig({testDir:'./e2e/practice-track-auth',outputDir:'./test-results/team-auth',workers:1,timeout:45000,
 use:{baseURL:'http://localhost:5189',storageState:storageFor('http://localhost:5189'),trace:'retain-on-failure',launchOptions:{args:['--no-sandbox']}},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{viewport:{width:390,height:844}}}],
 webServer:[authServer,
  {command:'../backend/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8021',cwd:'../backend',url:'http://127.0.0.1:8021/health',reuseExistingServer:false,
   env:{APP_ENV:'test',AUTH_DISABLED:'false',SUPABASE_URL:authUrl,SUPABASE_JWT_MODE:'hs256',SUPABASE_JWT_SECRET:jwtSecret,SUPABASE_SERVICE_ROLE_KEY:'',OPENAI_API_KEY:'',STT_PROVIDER:'off',PRACTICE_INSIGHTS_ENABLED:'true',PRACTICE_COMPETENCY_EVIDENCE_ENABLED:'false',DATABASE_URL:`sqlite:///${join(data,'test.db')}`,RECORDINGS_DIR:recordings,CORS_ORIGINS:'http://localhost:5189,http://127.0.0.1:5189'}},
  {command:'npm run dev -- --host 127.0.0.1 --port 5189 --strictPort',url:'http://localhost:5189',reuseExistingServer:false,env:{...frontendAuthEnv,VITE_API_URL:'http://localhost:8021',VITE_E2E_FAKE_FACE:'true'}}]});
