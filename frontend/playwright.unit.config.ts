import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/practice-track/unit',outputDir:'./test-results/practice-track-unit',fullyParallel:true,timeout:15000,projects:[{name:'unit'}]});
