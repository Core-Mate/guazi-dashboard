import { defineConfig } from 'vite'

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
      '/api': { target: 'http://localhost:8403', changeOrigin: true },
    },
  },
})
