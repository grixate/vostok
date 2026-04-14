import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }

          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/scheduler/')
          ) {
            return 'vendor-react'
          }

          if (id.includes('/phoenix/')) {
            return 'vendor-realtime'
          }

          if (
            id.includes('/@jellyfish-dev/membrane-webrtc-js/') ||
            id.includes('/@tauri-apps/')
          ) {
            return 'vendor-media'
          }

          if (id.includes('/lucide-react/')) {
            return 'vendor-icons'
          }

          if (id.includes('/motion/') || id.includes('/framer-motion/')) {
            return 'vendor-motion'
          }

          return 'vendor'
        }
      }
    }
  },
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${process.env.VITE_API_PORT || '4000'}`,
      '/socket': {
        target: `ws://127.0.0.1:${process.env.VITE_API_PORT || '4000'}`,
        ws: true
      }
    }
  }
})
