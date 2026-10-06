import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        // ruleWorker: utilityProcess that runs JavaScript rules in node:vm
        input: { index: resolve(__dirname, 'src/main/index.ts'), ruleWorker: resolve(__dirname, 'src/main/rules/jsWorker.ts') }
      }
    }
  },
  preload: {
    build: { externalizeDeps: true }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()]
  }
})
