import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const frontend = fileURLToPath(new URL('.', import.meta.url))
const repository = fileURLToPath(new URL('../', import.meta.url))

function sourceHmrGuard(): Plugin {
  const hashes = new Map<string, string>()

  const admitted = (file: string) =>
    (file.startsWith(join(frontend, 'src') + '/') ||
      file.startsWith(join(repository, 'contracts/src') + '/')) &&
    /\.(?:[cm]?[jt]sx?|css)$/.test(file)

  async function digest(file: string) {
    return createHash('sha256')
      .update(await readFile(file))
      .digest('hex')
  }

  return {
    name: 'source-byte-hmr',
    enforce: 'pre',
    async transform(_code, id) {
      const file = id.split('?')[0]
      if (admitted(file)) {
        hashes.set(file, await digest(file))
      }
      return null
    },
    async handleHotUpdate(context) {
      if (!admitted(context.file)) {
        return
      }
      const next = await digest(context.file)
      if (hashes.get(context.file) === next) {
        return []
      }
      hashes.set(context.file, next)
    },
  }
}

export default defineConfig({
  plugins: [sourceHmrGuard(), react()],
  envDir: false,
  server: {
    host: '127.0.0.1',
    strictPort: true,
    watch: { ignored: ['**/.amp/**', '**/*.md', '**/*.test.*', '**/*.spec.*', '**/dist/**'] },
  },
  preview: { host: '127.0.0.1' },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
})
