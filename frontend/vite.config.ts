import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Connect, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const frontend = fileURLToPath(new URL('.', import.meta.url))
const repository = fileURLToPath(new URL('../', import.meta.url))

/** The saved InvenTree read token and its temporary file while being replaced. */
const CREDENTIAL_FILE = /^(?:inventory-read-token|\.inventory-read-token\..+)$/

/** The file a dev-server request names: `/@fs/` paths are absolute, others are under the root. */
function requestedFile(url: string | undefined) {
  let path
  try {
    path = decodeURIComponent((url ?? '').split('?')[0])
  } catch {
    return undefined
  }
  return path.startsWith('/@fs/') ? path.slice('/@fs'.length) : join(frontend, path)
}

/**
 * Refuses any dev-server request whose file, after following links, is the saved read token,
 * whatever name the request used. The deny list below only sees the requested name.
 */
/** Whether a path, after following links, is the saved token; a missing path is not. */
function isCredential(path: string) {
  try {
    return CREDENTIAL_FILE.test(basename(realpathSync(path)))
  } catch {
    return false
  }
}

function credentialFileGuard(): Plugin {
  const refuseCredential: Connect.NextHandleFunction = (request, response, next) => {
    const file = requestedFile(request.url)
    // A directory request is answered with its index, which may itself be a link.
    const candidates = file ? [file, join(file, 'index.html')] : []
    if (candidates.some(isCredential)) {
      response.statusCode = 403
      response.end()
      return
    }
    next()
  }

  return {
    name: 'credential-file-guard',
    configureServer(server) {
      server.middlewares.use(refuseCredential)
      // Again after the HTML fallback has rewritten the URL, before the page is served.
      return () => {
        server.middlewares.use(refuseCredential)
      }
    },
  }
}

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
  plugins: [credentialFileGuard(), sourceHmrGuard(), react()],
  // The app has no public files; without a public directory nothing is served or copied from one.
  publicDir: false,
  // `#/` names this package's src, matching the intake server's subpath imports.
  resolve: { alias: [{ find: /^#\//, replacement: join(frontend, 'src') + '/' }] },
  envDir: false,
  server: {
    host: '127.0.0.1',
    strictPort: true,
    watch: { ignored: ['**/.amp/**', '**/*.md', '**/*.test.*', '**/*.spec.*', '**/dist/**'] },
    fs: {
      // Vite's own defaults, which a deny list replaces, plus the saved InvenTree read token,
      // so a secrets directory inside the workspace is never served through /@fs.
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem,key,p12,pfx,cer,der}',
        '.npmrc',
        '.yarnrc.yml',
        '**/.git/**',
        '**/inventory-read-token',
        '**/.inventory-read-token.*',
      ],
    },
  },
  preview: { host: '127.0.0.1' },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
})
