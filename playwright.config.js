import {defineConfig,devices} from '@playwright/test';
import path from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.cache/playwright');
export default defineConfig({
  testDir:'./e2e',timeout:45000,workers:2,reporter:'list',
  use:{baseURL:'http://127.0.0.1:4175',locale:'es-ES',timezoneId:'Europe/Madrid',trace:'retain-on-failure'},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'iphone-webkit',use:{...devices['iPhone 13']}},{name:'android-chromium',use:{...devices['Pixel 7']}}],
  webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4175 --strictPort',url:'http://127.0.0.1:4175',reuseExistingServer:false,env:{VITE_GOOGLE_CLIENT_ID:'local-e2e-public-client'}}
});
