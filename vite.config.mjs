import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/') && /(?:prosemirror|tiptap|marked)/.test(id)) {
            return 'editor'
          }
        },
      },
    },
  },
})
