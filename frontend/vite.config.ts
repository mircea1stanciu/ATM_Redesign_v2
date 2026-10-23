import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// The UI-test harness starts the backend on a free port and points the proxy at it.
const apiTarget = process.env.ATM_API_TARGET || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path,
      },
      // The frontend probes the backend's OpenAPI schema to feature-detect
      // available endpoints; it lives at the server root, so proxy it too.
      '/openapi.json': {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
      },
      '/ws': {
        target: apiTarget.replace(/^http/, 'ws'),
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Keep app code separate from heavy third-party libs for better caching and faster initial load.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts'
          if (id.includes('jspdf') || id.includes('html2canvas') || id.includes('dompurify')) return 'vendor-reports'
          if (id.includes('lucide-react')) return 'vendor-icons'
          if (id.includes('framer-motion')) return 'vendor-motion'
          if (id.includes('zustand')) return 'vendor-zustand'
          if (id.includes('react-router') || id.includes('@remix-run')) return 'vendor-router'
          if (id.includes('react') || id.includes('scheduler')) return 'vendor-react'

          return undefined
        },
      },
    },
  },
})
