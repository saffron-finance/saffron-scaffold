import { defineConfig } from '@playwright/test'
export default defineConfig({testDir:'./tests/browser',testMatch:'*.spec.mjs',timeout:120_000,workers:1,use:{headless:true,trace:'retain-on-failure'}})
