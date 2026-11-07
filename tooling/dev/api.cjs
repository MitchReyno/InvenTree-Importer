const { createRequire } = require('node:module')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { launch, stop } = require('./process.cjs')
const { watchCode, snapshot } = require('./watch.cjs')
const { developmentEnvironment, apiEnvironment } = require('./environment.cjs')

const repository = resolve(__dirname, '../..')
const intake = join(repository, 'intake-server')
const intakeRequire = createRequire(join(intake, 'package.json'))

async function main() {
  const environment = apiEnvironment(await developmentEnvironment(repository))
  let child
  let restarting = false
  let closing = false
  let chain = Promise.resolve()
  let finish
  const stopped = new Promise((done) => {
    finish = done
  })
  const shutdown = () => {
    closing = true
    child?.child.kill('SIGTERM')
    finish()
  }
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, shutdown)
  }
  async function start() {
    if (closing) {
      return
    }
    child = launch(
      'api',
      process.execPath,
      ['--import', pathToFileURL(intakeRequire.resolve('tsx')).href, 'src/main.ts'],
      { cwd: intake, env: environment },
      (output) => output.includes('"web_ready"'),
    )
    void child.exited.then(() => {
      if (!restarting && !closing) {
        process.exitCode = 1
        shutdown()
      }
    })
    await child.ready()
  }
  let close = () => {}
  const roots = [join(intake, 'src'), join(repository, 'contracts/src')]
  const initialSources = await Promise.all(roots.map(snapshot))
  try {
    await start()
    close = await watchCode(
      roots,
      (error) => {
        if (error) {
          process.exitCode = 1
          shutdown()
          return
        }
        chain = chain
          .then(async () => {
            if (closing) {
              return
            }
            restarting = true
            await stop([child])
            try {
              await start()
            } catch {
              process.stderr.write('API reload failed; fix source code to retry.\n')
            } finally {
              restarting = false
            }
          })
          .catch(() => {
            process.exitCode = 1
            shutdown()
          })
        return chain
      },
      200,
      initialSources,
    )
    await stopped
  } finally {
    closing = true
    close()
    await chain
    if (child) {
      await stop([child])
    }
  }
}
main().catch(() => {
  process.stderr.write('Development API failed.\n')
  process.exitCode = 1
})
