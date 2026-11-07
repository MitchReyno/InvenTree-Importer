#!/usr/bin/env node
// Screenshot diff: captures every fixture page in headless Chrome, in both themes at desktop and
// phone width, and fails when any pixel differs from the recorded baseline.
//
// Usage: node scripts/check-screenshots.cjs [--update] [--out <dir>] [--only <name>]
//   --update  record the baseline instead of comparing
//   --out     also write each shot, and a diff image for each changed one, to <dir>
//   --only    limit to fixture pages whose file name contains <name>
// The baseline lives in frontend/.screenshots/baseline (gitignored). The script starts its own
// Vite server. It finds Chrome on PATH or in Applications; CHROME_PATH overrides it.
// Needs Node 22+ (WebSocket, zlib.crc32).
const { spawn } = require('node:child_process')
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} = require('node:fs')
const { createServer } = require('node:net')
const { homedir, tmpdir } = require('node:os')
const { delimiter, join } = require('node:path')
const zlib = require('node:zlib')

const FRONTEND = join(__dirname, '..')
const FIXTURES = join(FRONTEND, 'tests', 'fixtures')
const BASELINE = join(FRONTEND, '.screenshots', 'baseline')
const THEMES = ['light', 'dark']
const WIDTHS = [1440, 390]
const SETTLE_MS = 1200
const BODY_FONT = 'Public Sans Variable'
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

// Animations, transitions and the caret are frozen, and the masthead scene (a three.js canvas
// with no CSS styling) is hidden, so two captures of unchanged styles are pixel-identical.
const FREEZE_CSS = `*, *::before, *::after {
  animation: none !important; transition: none !important; caret-color: transparent !important;
}
[data-testid="electronics-current"] { visibility: hidden !important; }`

function fixturePages(directory = FIXTURES) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => entry.name)
    .sort()
}

function scenarios(pages) {
  return pages.flatMap((page) =>
    THEMES.flatMap((theme) => WIDTHS.map((width) => ({ page, theme, width }))),
  )
}

function shotName({ page, theme, width }) {
  return `${page.replace(/\.html$/, '')}-${theme}-${width}.png`
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft
  const toLeft = Math.abs(estimate - left)
  const toUp = Math.abs(estimate - up)
  const toUpLeft = Math.abs(estimate - upLeft)
  if (toLeft <= toUp && toLeft <= toUpLeft) {
    return left
  }
  return toUp <= toUpLeft ? up : upLeft
}

// Decodes the non-interlaced 8-bit RGB and RGBA PNGs Chrome writes, as RGBA.
function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG')
  }
  let width = 0
  let height = 0
  let channels = 0
  const chunks = []
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const [depth, colour, , , interlace] = body.subarray(8, 13)
      channels = { 2: 3, 6: 4 }[colour]
      if (depth !== 8 || !channels || interlace !== 0) {
        throw new Error(`unsupported PNG: depth ${depth}, colour ${colour}, interlace ${interlace}`)
      }
    } else if (type === 'IDAT') {
      chunks.push(body)
    }
    offset += 12 + length
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  const rows = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const source = y * (stride + 1) + 1
    const target = y * stride
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? rows[target + x - channels] : 0
      const up = y > 0 ? rows[target - stride + x] : 0
      const upLeft = y > 0 && x >= channels ? rows[target - stride + x - channels] : 0
      const value = raw[source + x]
      const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter]
      rows[target + x] = (value + predicted) & 255
    }
  }
  if (channels === 4) {
    return { width, height, data: rows }
  }
  const data = Buffer.alloc(width * height * 4)
  for (let index = 0; index < width * height; index++) {
    rows.copy(data, index * 4, index * 3, index * 3 + 3)
    data[index * 4 + 3] = 255
  }
  return { width, height, data }
}

function chunk(type, body) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length)
  const named = Buffer.concat([Buffer.from(type, 'latin1'), body])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(named))
  return Buffer.concat([length, named, crc])
}

function encodePng({ width, height, data }) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Counts pixels that differ in any channel. Rows or columns only one image has count as changed.
// The diff image shows the newer shot faded, with changed pixels marked in red.
function comparePixels(before, after) {
  const width = Math.max(before.width, after.width)
  const height = Math.max(before.height, after.height)
  const diff = Buffer.alloc(width * height * 4)
  let changed = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4
      const inBefore = x < before.width && y < before.height
      const inAfter = x < after.width && y < after.height
      const a = inBefore ? (y * before.width + x) * 4 : -1
      const b = inAfter ? (y * after.width + x) * 4 : -1
      const differs =
        !inBefore || !inAfter || before.data.readUInt32BE(a) !== after.data.readUInt32BE(b)
      if (differs) {
        changed++
        diff.set([255, 0, 64, 255], target)
      } else {
        const grey = Math.round(
          (after.data[b] + after.data[b + 1] + after.data[b + 2]) / 3 / 4 + 191,
        )
        diff.set([grey, grey, grey, 255], target)
      }
    }
  }
  return {
    changed,
    sizeChanged: before.width !== after.width || before.height !== after.height,
    diff: { width, height, data: diff },
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function waitFor(check, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await check()
    if (value) {
      return value
    }
    await delay(150)
  }
  throw new Error(`${what} did not start`)
}

function startVite(port) {
  const vite = spawn(
    process.execPath,
    [
      join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--port',
      String(port),
      '--strictPort',
    ],
    { cwd: FRONTEND, stdio: 'ignore' },
  )
  return vite
}

const CHROME_NAMES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'chrome',
]
const MAC_CHROME = 'Google Chrome.app/Contents/MacOS/Google Chrome'

// The first Chrome or Chromium on PATH, then the standard macOS application folders.
function findChrome() {
  const onPath = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .flatMap((directory) => CHROME_NAMES.map((name) => join(directory, name)))
  const macApps =
    process.platform === 'darwin'
      ? [join('/Applications', MAC_CHROME), join(homedir(), 'Applications', MAC_CHROME)]
      : []
  const found = [...onPath, ...macApps].find((candidate) => existsSync(candidate))
  if (!found) {
    throw new Error('Chrome not found on PATH or in Applications; set CHROME_PATH.')
  }
  return found
}

// Ends a child process; one that has already exited, or ignores SIGTERM for 5s, is not awaited.
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolve) => {
    const force = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 5000)
    child.once('exit', () => {
      clearTimeout(force)
      resolve()
    })
    child.kill()
  })
}

function launchChrome(binary, profile) {
  return spawn(
    binary,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      // CPU raster with a fixed colour profile, so anti-aliased edges render the same each run.
      '--disable-gpu',
      '--force-color-profile=srgb',
      '--disable-lcd-text',
      '--hide-scrollbars',
      '--font-render-hinting=none',
      '--no-first-run',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
}

function connect(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let nextId = 1
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const waiter = pending.get(message.id)
    if (!waiter) {
      return
    }
    pending.delete(message.id)
    if (message.error) {
      waiter.reject(new Error(`${waiter.method}: ${message.error.message}`))
    } else {
      waiter.resolve(message.result)
    }
  })
  function send(method, params = {}) {
    const id = nextId++
    socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }))
  }
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve({ send, close: () => socket.close() }))
    socket.addEventListener('error', reject)
  })
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed')
  }
  return result.result.value
}

async function capture(cdp, origin, scenario) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: scenario.width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('bench-intake.theme', ${JSON.stringify(scenario.theme)})`,
  })
  await cdp.send('Page.navigate', { url: `${origin}/tests/fixtures/${scenario.page}` })
  await delay(SETTLE_MS)
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
  // Fixtures that do not start the theme controller still take the theme.
  await evaluate(
    cdp,
    `(async () => {
      document.documentElement.dataset.theme = ${JSON.stringify(scenario.theme)}
      const style = document.createElement('style')
      style.textContent = ${JSON.stringify(FREEZE_CSS)}
      document.head.append(style)
      document.activeElement?.blur?.()
      await document.fonts.ready
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })()`,
  )
  // A web font the server cannot serve falls back silently. Faces load only when text uses them,
  // so any failed face fails the capture, and the body face must have loaded.
  const fonts = await evaluate(
    cdp,
    `[...document.fonts].map((font) => ({ family: font.family.replace(/"/g, ''), status: font.status }))`,
  )
  const failed = fonts.filter((font) => font.status === 'error').map((font) => font.family)
  const bodyLoaded = fonts.some((font) => font.family === BODY_FONT && font.status === 'loaded')
  if (failed.length > 0 || !bodyLoaded) {
    throw new Error(
      `${shotName(scenario)}: web fonts did not load (${failed.length > 0 ? failed.join(', ') : BODY_FONT})`,
    )
  }
  const { cssContentSize } = await cdp.send('Page.getLayoutMetrics')
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: {
      x: 0,
      y: 0,
      width: scenario.width,
      height: Math.ceil(cssContentSize.height),
      scale: 1,
    },
  })
  return Buffer.from(result.data, 'base64')
}

function option(argv, name) {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : null
}

async function main(argv) {
  const update = argv.includes('--update')
  const outDir = option(argv, '--out')
  const only = option(argv, '--only')
  const pages = fixturePages().filter((page) => !only || page.includes(only))
  if (pages.length === 0) {
    console.error(`No fixture page matches ${only}`)
    return 2
  }
  if (!update && !existsSync(BASELINE)) {
    console.error(
      'No baseline yet. Record one with: pnpm --filter @invimport/frontend screenshots --update',
    )
    return 2
  }
  mkdirSync(BASELINE, { recursive: true })
  if (outDir) {
    mkdirSync(outDir, { recursive: true })
  }

  // Found before anything starts, so a missing Chrome leaves nothing to clean up.
  const binary = process.env.CHROME_PATH || findChrome()
  const port = await freePort()
  const vite = startVite(port)
  const origin = `http://127.0.0.1:${port}`
  const profile = mkdtempSync(join(tmpdir(), 'screenshot-check-'))
  const chrome = launchChrome(binary, profile)
  try {
    await waitFor(
      () =>
        fetch(origin).then(
          (response) => response.ok,
          () => false,
        ),
      30000,
      'Vite',
    )
    const activePort = join(profile, 'DevToolsActivePort')
    const devtools = await waitFor(
      () => existsSync(activePort) && readFileSync(activePort, 'utf8').split('\n')[0],
      15000,
      'Chrome',
    )
    const targets = await (await fetch(`http://127.0.0.1:${devtools}/json/list`)).json()
    const cdp = await connect(targets.find((target) => target.type === 'page').webSocketDebuggerUrl)
    await cdp.send('Page.enable')

    let changedShots = 0
    for (const scenario of scenarios(pages)) {
      const name = shotName(scenario)
      const shot = await capture(cdp, origin, scenario)
      if (outDir) {
        writeFileSync(join(outDir, name), shot)
      }
      if (update) {
        writeFileSync(join(BASELINE, name), shot)
        console.log(`recorded ${name}`)
        continue
      }
      const baselinePath = join(BASELINE, name)
      if (!existsSync(baselinePath)) {
        changedShots++
        console.log(`NEW ${name}: no baseline`)
        continue
      }
      const baseline = readFileSync(baselinePath)
      if (baseline.equals(shot)) {
        console.log(`ok ${name}`)
        continue
      }
      const result = comparePixels(decodePng(baseline), decodePng(shot))
      if (result.changed === 0) {
        console.log(`ok ${name}`)
        continue
      }
      changedShots++
      if (outDir) {
        writeFileSync(join(outDir, name.replace(/\.png$/, '.diff.png')), encodePng(result.diff))
      }
      console.log(
        `CHANGED ${name}: ${result.changed} pixels${result.sizeChanged ? ' (page size changed)' : ''}`,
      )
    }
    cdp.close()
    if (!update) {
      console.log(
        changedShots === 0 ? 'Screenshots unchanged.' : `${changedShots} screenshots changed.`,
      )
    }
    return changedShots === 0 ? 0 : 1
  } finally {
    await Promise.all([stop(chrome), stop(vite)])
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

module.exports = { comparePixels, decodePng, encodePng, fixturePages, scenarios, shotName }

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      console.error(error)
      process.exitCode = 1
    },
  )
}
