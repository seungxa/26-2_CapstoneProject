import {defineConfig} from '@playwright/test';
import {authServer,storageFor,frontendAuthEnv} from './tests/practice-track/support/config';
export default defineConfig({testDir:'./tests/practice-track/validation',testMatch:'gaze-attempts.spec.ts',workers:1,timeout:45000,outputDir:'./test-results/practice-track-gaze',
 use:{baseURL:'http://127.0.0.1:5185',storageState:storageFor('http://127.0.0.1:5185'),viewport:{width:1000,height:700},launchOptions:{args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}},
 webServer:[authServer,{command:'npm run dev -- --host 127.0.0.1 --port 5185 --strictPort --mode validation',url:'http://127.0.0.1:5185',reuseExistingServer:false,env:{...frontendAuthEnv,VITE_E2E_FAKE_FACE:'true',VITE_GAZE_LAB:'true'}}]});
