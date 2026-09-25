import { defineConfig, devices } from '@playwright/test'
import base from './playwright.config'

export default defineConfig(base, {
  testMatch: /flow-(01|02|03|13|16).*\.spec\.ts|keyboard-navigation\.spec\.ts/,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
})
