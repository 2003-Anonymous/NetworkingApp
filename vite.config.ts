import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'

// https://vitejs.dev/config/
export default defineConfig({
  root: 'src/renderer',
  plugins: [
    electron({
      main: {
        entry: path.join(__dirname, 'electron/main.ts'),
        vite: {
          build: {
            outDir: path.join(__dirname, 'dist-electron'),
            rollupOptions: {
              external: [/^[^./\0]/],
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            outDir: path.join(__dirname, 'dist-electron'),
          },
        },
      },
      renderer: undefined,
    }),
  ],
})
