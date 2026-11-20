const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { copySources, digestInputs, sourceDigest } = require('../dev/runner-digest.cjs')

const REPOSITORY = resolve(__dirname, '../..')

test('the digest covers every build-context COPY source in the runner Dockerfiles', async () => {
  const inputs = await digestInputs(REPOSITORY)
  const covered = (path) => inputs.some((input) => path === input || path.startsWith(`${input}/`))
  for (const dockerfile of ['app.Dockerfile', 'runner.Dockerfile']) {
    const text = await readFile(join(REPOSITORY, 'tooling/deployment/images', dockerfile), 'utf8')
    // Read independently of the parser: each COPY line without --from, minus its destination.
    for (const line of text
      .split('\n')
      .filter((entry) => /^COPY\s/.test(entry) && !/--from=/.test(entry))) {
      const words = line
        .split(/\s+/)
        .slice(1)
        .filter((word) => !word.startsWith('--'))
      for (const source of words.slice(0, -1)) {
        assert.ok(covered(source.replace(/\/$/, '')), `${dockerfile}: ${source}`)
      }
    }
    assert.ok(inputs.includes(`tooling/deployment/images/${dockerfile}`))
    assert.ok(inputs.includes(`tooling/deployment/images/${dockerfile}.dockerignore`))
  }
  assert.ok(inputs.includes('tooling/deployment/guest'))
})

test('COPY sources skip stage copies and keep every source before the destination', () => {
  const text = [
    'FROM base AS one',
    'COPY --from=uv /uv /usr/local/bin/uv',
    'COPY package.json pnpm-lock.yaml ./',
    'COPY --chmod=0555 fixtures/agent.cjs /opt/agent.cjs',
    'COPY frontend/ frontend',
    'RUN echo COPY not-a-copy',
  ].join('\n')
  assert.deepEqual(copySources(text), [
    'package.json',
    'pnpm-lock.yaml',
    'fixtures/agent.cjs',
    'frontend',
  ])
})

test('a COPY form the parser cannot read is refused rather than skipped', () => {
  for (const line of [
    'ADD archive.tar /opt',
    'COPY ["a b", "/opt"]',
    'COPY $SOURCE /opt',
    'COPY onlyone',
  ]) {
    assert.throws(() => copySources(line), { message: 'runner_digest_unsupported_copy' }, line)
  }
})

/** A small Git repository shaped like the runner's build inputs. */
async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), 'runner-digest-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const write = async (path, content) => {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), content)
  }
  await write('tooling/deployment/images/app.Dockerfile', 'FROM node AS app\nCOPY src src\n')
  await write('tooling/deployment/images/app.Dockerfile.dockerignore', 'node_modules\n')
  await write(
    'tooling/deployment/images/runner.Dockerfile',
    'FROM app\nCOPY --from=app /app /app\n',
  )
  await write('tooling/deployment/images/runner.Dockerfile.dockerignore', '\n')
  await write('tooling/deployment/guest/Dockerfile', 'FROM node\n')
  await write('src/main.ts', 'export {}\n')
  await write('.gitignore', 'src/*.log\n')
  execFileSync('git', ['init', '-q', root])
  execFileSync('git', ['-C', root, 'add', '.'])
  return { root, write }
}

test('the digest follows edits, Dockerfile ignore files and untracked sources, not ignored files', async (t) => {
  const { root, write } = await repository(t)
  const first = await sourceDigest(root)
  assert.match(first, /^[0-9a-f]{64}$/)
  assert.equal(await sourceDigest(root), first)

  await write('src/debug.log', 'ignored')
  assert.equal(await sourceDigest(root), first)

  await write('src/main.ts', 'export const changed = true\n')
  const edited = await sourceDigest(root)
  assert.notEqual(edited, first)

  await write('tooling/deployment/images/app.Dockerfile.dockerignore', 'node_modules\nsrc/extra\n')
  const ignoreChanged = await sourceDigest(root)
  assert.notEqual(ignoreChanged, edited)

  await write('src/new.ts', 'export {}\n')
  const added = await sourceDigest(root)
  assert.notEqual(added, ignoreChanged)

  // The guest image's whole context is an input, whatever its Dockerfile copies.
  await write('tooling/deployment/guest/package.json', '{}\n')
  assert.notEqual(await sourceDigest(root), added)
})
