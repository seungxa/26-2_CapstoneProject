import {defineConfig} from '@playwright/test';
import base from './playwright.practice-track.config';
const servers=Array.isArray(base.webServer)?base.webServer:[base.webServer!];
export default defineConfig({...base,testDir:'./e2e/practice-track-local-ai',outputDir:'./test-results/practice-track-local-ai',webServer:[
 {command:'.venv/bin/python evals/local_openai_fixture.py --port 8012',cwd:'../backend',url:'http://127.0.0.1:8012/health',reuseExistingServer:false},
 ...servers.map(server=>server.cwd==='../backend'?{...server,env:{...server.env,OPENAI_API_KEY:'local-protocol-fixture',OPENAI_BASE_URL:'http://127.0.0.1:8012/v1',PRACTICE_COMPETENCY_EVIDENCE_ENABLED:'true'}}:server)]});
