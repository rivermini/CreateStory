import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    // Dev server only (npm run dev / preview). `true` accepts any Host so it stays
    // domain-agnostic if you ever run dev behind a tunnel; the built bundle served
    // by nginx does not use this. Production is unaffected.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/react-dom')) return 'vendor-react-dom';
          if (id.includes('node_modules/react')) return 'vendor-react';
          if (id.includes('node_modules/react-router')) return 'vendor-react-router';
        },
      },
    },
  },
})
