import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { version } from './package.json'

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react()],
  build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 2000 },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.API_PROXY ?? 'http://localhost:8000', changeOrigin: true } },
  },
})
