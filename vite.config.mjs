import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

// PDF.js requests these resources by their original names while decoding a page.
function offlinePdfResources() {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  return {
    name:'offline-pdf-resources', apply:'build',
    async generateBundle() {
      const emit = async (name, input) => this.emitFile({
        type:'asset', fileName:'assets/pdf-resources/' + name, source:await readFile(input),
      })
      await emit('LICENSE', join(root,'LICENSE'))
      for (const dir of ['cmaps','standard_fonts','wasm','iccs']) {
        for (const name of await readdir(join(root,dir))) await emit(dir + '/' + name, join(root,dir,name))
      }
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), offlinePdfResources()],
  build: {
    license: { fileName: 'third-party-licenses.md' },
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
