import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // A relative base lets the standalone build work at a domain root or under
  // any reverse-proxy prefix without carrying deployment-specific paths.
  base: './',
  server: { port: 5180 },
})
