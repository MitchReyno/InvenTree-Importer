#!/usr/bin/env node
// Browser qualification: samples masthead frames in headless Chrome and fails when any
// electronics-current pixel shows inside a masthead text box, in either theme.
//
// Usage: node scripts/check-masthead-mask.cjs <fixture URL> [--out <dir>]
// Start the UI first (pnpm dev:ui) and pass e.g.
// http://127.0.0.1:5173/tests/fixtures/header-status.html
// CHROME_PATH overrides the Chrome binary. Needs Node's built-in WebSocket (Node 22+).
const { spawn } = require('node:child_process')
const {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SETTLE_MS = 2500
const FRAME_GAP_MS = 350
const FRAMES = 6
// Channel difference that counts as a drawn part rather than PNG noise.
const PIXEL_THRESHOLD = 8

const SCENARIOS = [
  { theme: 'light', width: 1440, reducedMotion: false, checkText: true },
  { theme: 'dark', width: 1440, reducedMotion: false, checkText: true },
  { theme: 'light', width: 1100, reducedMotion: false, checkText: true },
  { theme: 'dark', width: 1100, reducedMotion: false, checkText: true },
  { theme: 'light', width: 1440, reducedMotion: true, checkText: true },
  { theme: 'dark', width: 1440, reducedMotion: true, checkText: true },
  // Compact bars dim parts under the text by design; record them without the text rule.
  { theme: 'light', width: 390, reducedMotion: false, checkText: false },
  { theme: 'dark', width: 390, reducedMotion: false, checkText: false },
]

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf8')
      if (content.includes('\n')) {
        return content
      }
    }
    await delay(100)
  }
  throw new Error(`Chrome did not start: ${path} missing`)
}

function launchChrome(profile) {
  const binary = process.env.CHROME_PATH || DEFAULT_CHROME
  return spawn(
    binary,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
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

// Runs in the page: the masthead's text boxes, as viewport rectangles.
const MEASURE = `(() => {
  const canvas = document.querySelector('[data-testid="electronics-current"]')
  const header = canvas.closest('header')
  const row = canvas.nextElementSibling
  const boxes = [...row.children]
    .filter((child) => child.offsetWidth > 0 && (child.textContent.trim() || child.querySelector('button, a')))
    .map((child) => {
      const rect = child.getBoundingClientRect()
      return { name: (child.textContent.trim() || child.tagName).slice(0, 40), x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })
  const rect = header.getBoundingClientRect()
  return { header: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, boxes, theme: document.documentElement.dataset.theme }
})()`

// Runs in the page: counts differing pixels per box between two PNG screenshots.
function compareSource(referenceData, frameData, boxes, origin) {
  return `(async () => {
    async function pixels(data) {
      const blob = await (await fetch('data:image/png;base64,' + data)).blob()
      const bitmap = await createImageBitmap(blob)
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')
      context.drawImage(bitmap, 0, 0)
      return context.getImageData(0, 0, bitmap.width, bitmap.height)
    }
    const reference = await pixels(${JSON.stringify(referenceData)})
    const frame = await pixels(${JSON.stringify(frameData)})
    const boxes = ${JSON.stringify(boxes)}
    const origin = ${JSON.stringify(origin)}
    function differs(x, y) {
      const index = (y * reference.width + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        if (Math.abs(reference.data[index + channel] - frame.data[index + channel]) > ${PIXEL_THRESHOLD}) {
          return true
        }
      }
      return false
    }
    function count(left, top, width, height) {
      let total = 0
      const x0 = Math.max(0, Math.floor(left))
      const y0 = Math.max(0, Math.floor(top))
      const x1 = Math.min(reference.width, Math.ceil(left + width))
      const y1 = Math.min(reference.height, Math.ceil(top + height))
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (differs(x, y)) total++
        }
      }
      return total
    }
    return {
      perBox: boxes.map((box) => ({ name: box.name, pixels: count(box.x - origin.x, box.y - origin.y, box.width, box.height) })),
      anywhere: count(0, 0, reference.width, reference.height),
    }
  })()`
}

async function screenshot(cdp, clip) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { ...clip, scale: 1 },
  })
  return result.data
}

async function runScenario(cdp, url, scenario, outDir) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: scenario.width,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      {
        name: 'prefers-reduced-motion',
        value: scenario.reducedMotion ? 'reduce' : 'no-preference',
      },
    ],
  })
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('bench-intake.theme', ${JSON.stringify(scenario.theme)})`,
  })
  await cdp.send('Page.navigate', { url })
  await delay(SETTLE_MS)
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })

  const label = `${scenario.theme}-${scenario.width}${scenario.reducedMotion ? '-reduced' : ''}`
  const layout = await evaluate(cdp, MEASURE)
  if (layout.theme !== scenario.theme) {
    throw new Error(`${label}: page theme is ${layout.theme}`)
  }
  const clip = layout.header
  if (outDir) {
    writeFileSync(join(outDir, `${label}.png`), Buffer.from(await screenshot(cdp, clip), 'base64'))
  }

  const row = `document.querySelector('[data-testid="electronics-current"]').nextElementSibling.style`
  const canvas = `document.querySelector('[data-testid="electronics-current"]').style`
  await evaluate(cdp, `${row}.visibility = 'hidden'`)
  await evaluate(cdp, `${canvas}.visibility = 'hidden'`)
  const reference = await screenshot(cdp, clip)
  await evaluate(cdp, `${canvas}.visibility = 'visible'`)

  const frames = []
  for (let index = 0; index < FRAMES; index++) {
    await delay(FRAME_GAP_MS)
    frames.push(await screenshot(cdp, clip))
  }
  await evaluate(cdp, `${row}.visibility = 'visible'`)

  const samples = []
  for (const frame of frames) {
    samples.push(await evaluate(cdp, compareSource(reference, frame, layout.boxes, clip)))
  }
  const textPixels = Math.max(
    ...samples.map((sample) => Math.max(...sample.perBox.map((box) => box.pixels))),
  )
  const partPixels = Math.max(...samples.map((sample) => sample.anywhere))
  const motion = await evaluate(cdp, compareSource(frames[0], frames[frames.length - 1], [], clip))
  const failures = []
  if (scenario.checkText && textPixels > 0) {
    const worst = samples.flatMap((sample) => sample.perBox).filter((box) => box.pixels > 0)
    failures.push(
      `parts over text: ${worst.map((box) => `${box.name} (${box.pixels}px)`).join(', ')}`,
    )
  }
  if (scenario.reducedMotion && motion.anywhere > 0) {
    failures.push(`reduced motion still frame changed by ${motion.anywhere}px`)
  }
  if (scenario.reducedMotion && partPixels === 0) {
    failures.push('reduced motion drew no parts')
  }

  return {
    label,
    boxes: layout.boxes.length,
    textPixels,
    partPixels,
    movedPixels: motion.anywhere,
    failures,
  }
}

async function main(argv) {
  const url = argv.find((arg) => !arg.startsWith('--'))
  const outIndex = argv.indexOf('--out')
  const outDir = outIndex >= 0 ? argv[outIndex + 1] : null
  if (!url) {
    console.error('Usage: node scripts/check-masthead-mask.cjs <fixture URL> [--out <dir>]')
    return 2
  }
  if (outDir) {
    mkdirSync(outDir, { recursive: true })
  }

  const profile = mkdtempSync(join(tmpdir(), 'masthead-check-'))
  const chrome = launchChrome(profile)
  try {
    const port = (await waitForFile(join(profile, 'DevToolsActivePort'), 15000)).split('\n')[0]
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const page = targets.find((target) => target.type === 'page')
    const cdp = await connect(page.webSocketDebuggerUrl)
    await cdp.send('Page.enable')

    let failed = false
    for (const scenario of SCENARIOS) {
      const result = await runScenario(cdp, url, scenario, outDir)
      const status = result.failures.length > 0 ? 'FAIL' : 'ok'
      failed ||= result.failures.length > 0
      console.log(
        `${status} ${result.label}: ${result.boxes} text boxes, max part pixels in text ${result.textPixels}, ` +
          `part pixels in bar ${result.partPixels}, moved pixels ${result.movedPixels}` +
          (result.failures.length > 0 ? ` — ${result.failures.join('; ')}` : ''),
      )
    }
    cdp.close()
    return failed ? 1 : 0
  } finally {
    const exited = new Promise((resolve) => chrome.once('exit', resolve))
    chrome.kill()
    await exited
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

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
