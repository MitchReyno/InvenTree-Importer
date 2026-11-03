const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, mkdir, writeFile, readFile, utimes } = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { setTimeout: delay } = require('node:timers/promises')
const { isCode, snapshot, watchCode } = require('../dev/watch.cjs')
const { launch, stop, startupGroup } = require('../dev/process.cjs')

test('source watcher ignores runtime data, documents, tests and identical-byte saves, but sees code creation and edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dev-watch-'))
  const code = join(root, 'main.ts')
  await writeFile(code, 'export const value = 1\n')
  let changes = 0
  const close = await watchCode(
    [root],
    (error) => {
      assert.ifError(error)
      changes++
    },
    30,
  )
  try {
    const original = await snapshot(root)
    await writeFile(join(root, 'state.json'), '{"revision":2}')
    await writeFile(join(root, 'notes.md'), 'operator notes')
    await writeFile(join(root, 'main.test.ts'), 'test code')
    await writeFile(code, await readFile(code))
    await utimes(code, new Date(), new Date())
    await delay(150)
    assert.equal(changes, 0)
    assert.equal(await snapshot(root), original)
    await writeFile(code, 'export const value = 2\n')
    await waitFor(() => changes === 1)
    await mkdir(join(root, 'feature'))
    await writeFile(join(root, 'feature', 'new.ts'), 'export const added = true\n')
    await waitFor(() => changes === 2)
    await mkdir(join(root, 'uploads'))
    await writeFile(join(root, 'uploads', 'ignored.ts'), 'not application source')
    await delay(150)
    assert.equal(changes, 2)
  } finally {
    close()
  }
})

test('watch policy admits application source and excludes runtime paths and test files', () => {
  assert.equal(isCode('feature/component.tsx'), true)
  assert.equal(isCode('feature/styles.css'), true)
  assert.equal(isCode('migrations/0012_sample.sql'), true)
  for (const path of [
    '.amp/state.ts',
    'dist/main.js',
    'node_modules/test.js',
    'component.test.tsx',
    'README.md',
    'private.json',
    'uploads/photo.png',
  ]) {
    assert.equal(isCode(path), false, path)
  }
})

test('owned children drain on SIGTERM without leaving a long shutdown timer alive', async () => {
  const child = launch(
    'test-child',
    process.execPath,
    [
      '-e',
      'process.on("SIGTERM",()=>process.exit(0));console.log("READY");setInterval(()=>{},1000)',
    ],
    {},
    (output) => output.includes('READY'),
  )
  await child.ready(2000)
  await stop([child], 1000)
  assert.equal(child.child.exitCode, 0)
})

async function waitFor(predicate) {
  const deadline = Date.now() + 2000
  while (!predicate()) {
    if (Date.now() > deadline) {
      assert.fail('source update not observed')
    }
    await delay(10)
  }
}

test('changes during application startup are reconciled when the watcher attaches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dev-startup-watch-'))
  const code = join(root, 'main.ts')
  await writeFile(code, 'export const value = 1\n')
  const baseline = [await snapshot(root)]
  await writeFile(code, 'export const value = 2\n')
  let changes = 0
  const close = await watchCode(
    [root],
    (error) => {
      assert.ifError(error)
      changes++
    },
    30,
    baseline,
  )
  try {
    assert.equal(changes, 1)
  } finally {
    close()
  }
})

test('a stale ready marker cannot make an exited process ready', async () => {
  const owned = launch(
    'failed-ready',
    process.execPath,
    ['-e', 'console.log("READY");process.exit(1)'],
    {},
    (text) => text.includes('READY'),
  )
  await owned.exited
  await assert.rejects(owned.ready(), /failed-ready_stopped/)
})

test('a ready sibling exit aborts startup while a later service initializes', async () => {
  const group = startupGroup()
  const first = launch(
    'first',
    process.execPath,
    ['-e', 'console.log("READY");setInterval(()=>{},1000)'],
    {},
    (text) => text.includes('READY'),
  )
  const second = launch(
    'second',
    process.execPath,
    ['-e', 'setInterval(()=>{},1000)'],
    {},
    (text) => text.includes('READY'),
  )
  const watchedFirst = group.watch(first)
  const watchedSecond = group.watch(second)
  try {
    await watchedFirst.ready(2000)
    first.child.kill('SIGTERM')
    await assert.rejects(watchedSecond.ready(2000), /first_stopped_during_startup/)
    assert.throws(() => group.confirm(), /first_stopped_during_startup/)
  } finally {
    await stop([first, second], 2000)
  }
})
