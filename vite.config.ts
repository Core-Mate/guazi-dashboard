import { defineConfig } from 'vite'

var saasAdminOrigin = process.env.VITE_COREMATE_SAAS_ADMIN_ORIGIN || 'http://127.0.0.1:12306'

export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: '../docs/dashboard',
    emptyOutDir: true,
  },
  server: {
    port: 8402,
    proxy: {
      '/api': { target: saasAdminOrigin, changeOrigin: true },
    },
  },
})
