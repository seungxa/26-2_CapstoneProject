import {defineConfig} from '@playwright/test';
import {frontendAuthEnv} from './tests/practice-track/support/config';
export default defineConfig({testDir:'./tests/practice-track/validation',testMatch:'media-browser.spec.ts',workers:1,timeout:90000,outputDir:'./test-results/practice-track-media',
 use:{baseURL:'http://127.0.0.1:5183',launchOptions:{args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5183 --strictPort --mode validation',url:'http://127.0.0.1:5183',reuseExistingServer:false,env:{...frontendAuthEnv,VITE_E2E_FAKE_FACE:'false',VITE_FACE_MODEL_URL:'http://127.0.0.1:5183/fixture/face.task',VITE_VALIDATION_CODE_VERSION:process.env.VITE_VALIDATION_CODE_VERSION||'unversioned-working-tree',VITE_VALIDATION_DIRTY:'true'}}});
