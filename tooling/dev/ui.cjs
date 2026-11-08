const { createRequire } = require('node:module')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const repository = resolve(__dirname, '../..')
const frontend = join(repository, 'frontend')
const frontendRequire = createRequire(join(frontend, 'package.json'))
async function main() {
  const port = Number(process.env.INTAKE_DEV_PUBLIC_PORT)
  const apiPort = Number(process.env.INTAKE_DEV_API_PORT)
  for (const value of [port, apiPort]) {
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
      throw new Error('invalid_development_port')
    }
  }
  const { createServer } = await import(pathToFileURL(frontendRequire.resolve('vite')).href)
  const vite = await createServer({
    root: frontend,
    configFile: join(frontend, 'vite.config.ts'),
    envDir: false,
    mode: 'development',

    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      watch: { ignored: ['**/.amp/**', '**/*.md', '**/*.test.*', '**/*.spec.*', '**/dist/**'] },
      proxy: {
        '/api': { target: `http://127.0.0.1:${apiPort}`, ws: true, changeOrigin: false },
        ...(process.env.INTAKE_PERSONAL_MANAGEMENT === '1'
          ? { '/personal-runner/claude': { target: 'http://127.0.0.1:14315', changeOrigin: false } }
          : {}),
      },
    },
  })
  await vite.listen()
  process.stdout.write('DEV_UI_READY\n')
}
main().catch(() => {
  process.stderr.write('Development UI failed.\n')
  process.exitCode = 1
})
