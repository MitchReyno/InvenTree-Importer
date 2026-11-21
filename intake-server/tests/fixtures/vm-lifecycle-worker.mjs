// Controlled VM worker for the physical cancellation fixture. No account or external network.
import { createServer } from 'node:net'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { Frames } from './frames.ts'

const server = createServer()
server.listen('/run/turn/worker.sock')
const [socket] = await once(server, 'connection')
server.close()
const frames = new Frames(socket)
const { opening, identity } = await frames.read()
const browserCase = opening.text === 'lifecycle-browser'
if (browserCase) {
  // Wait for Chromium to open its actual debugging endpoint before acknowledging startup.
  const child = spawn('chromium', ['--headless', '--disable-gpu', '--disable-dev-shm-usage',
    '--user-data-dir=/tmp/qualification-profile','--remote-debugging-port=0','about:blank'],
    {stdio:'ignore',detached:true})
  const deadline = Date.now() + 20000
  while (!(await readFile('/tmp/qualification-profile/DevToolsActivePort','utf8').catch(() => ''))) {
    if (child.exitCode !== null || Date.now() >= deadline) throw Error('browser_start_failed')
    await delay(100)
  }
}
await frames.send({request:{provider:{providerSessionId:identity.lineage,actualModel:'haiku'}}})
await frames.read()
if (browserCase) {
  // Deliberately outlive transport loss. Only confirmed container removal can release this slot.
  await new Promise(() => setInterval(() => {}, 60000))
} else {
  for (;;) {
    await frames.send({request:{nextDelivery:true}})
    if ((await frames.read()).text === 'finish sibling') break
    await delay(200)
  }
  await frames.send({outcome:'done'})
  socket.end()
}
