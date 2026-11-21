import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  cpSync,
  symlinkSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'invimport-format-test-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  for (const file of [
    'package.json',
    '.prettierrc.json',
    '.prettierignore',
    '.pre-commit-config.yaml',
    '.remarkrc.json',
    'eslint.config.mjs',
    'tooling/eslint/readability.mjs',
  ]) {
    mkdirSync(dirname(join(cwd, file)), { recursive: true })
    cpSync(join(root, file), join(cwd, file))
  }
  // Reuse installed tools, never install shared hooks or change the source worktree's index.
  symlinkSync(join(root, 'node_modules'), join(cwd, 'node_modules'), 'junction')
  symlinkSync(join(root, 'backend'), join(cwd, 'backend'), 'junction')
  const run = (command, args, status = 0) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000 })
    assert.equal(result.error, undefined)
    assert.equal(
      result.status,
      status,
      `${command} ${args.join(' ')}\n${result.stdout}${result.stderr}`,
    )
    return result.stdout + result.stderr
  }
  const write = (file, value) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true })
    writeFileSync(join(cwd, file), value)
  }
  const read = (file) => readFileSync(join(cwd, file), 'utf8')
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' })
  git('init', '--quiet')
  git('config', 'user.name', 'Formatting test')
  git('config', 'user.email', 'formatting-test@example.invalid')
  appendFileSync(join(cwd, git('rev-parse', '--git-path', 'info/exclude').trim()), '\n/.amp/in/\n')
  // No commit is needed: an unborn isolated index is sufficient for pre-commit.
  const hook = (id, status = 0) =>
    run('uv', ['run', '--project', 'backend', 'pre-commit', 'run', id], status)
  return { cwd, run, write, read, git, hook }
}

test('frontend styled templates format without changing generator template bytes', (t) => {
  const { run, write, read } = fixture(t)
  const template = 'color:red;padding:0  2px;'
  write(
    'frontend/src/Probe.tsx',
    "import styled from 'styled-components'\nexport const Probe = styled.div`" + template + '`\n',
  )
  write(
    'contracts/scripts/probe.cjs',
    'const style = css`' + template + '`\nmodule.exports = style\n',
  )
  run('pnpm', ['format'])
  assert.match(read('frontend/src/Probe.tsx'), /color: red;\n\s+padding: 0 2px;/)
  assert.ok(read('contracts/scripts/probe.cjs').includes('`' + template + '`'))
  const formatted = read('frontend/src/Probe.tsx')
  run('pnpm', ['format:check'])
  run('pnpm', ['format'])
  assert.equal(read('frontend/src/Probe.tsx'), formatted)
})

test('code CLI formats supported languages, is idempotent, and preserves excluded bytes', (t) => {
  const { run, write, read } = fixture(t)
  const code = {
    'probe.js': 'export const value={message:"hello"};\n',
    'probe.jsx': 'export const View=()=> <div>Hello</div>;\n',
    'probe.ts': 'export const value:number=1;\n',
    'probe.tsx': 'export const View=()=> <div className="test">Hello</div>;\n',
    'probe.cjs': 'module.exports={message:"hello"};\n',
    'probe.mjs': 'export const value={message:"hello"};\n',
    'probe.cts': 'export const value:number=1;\n',
    'probe.mts': 'export const value:number=1;\n',
    'probe.css': '.test{color:red;padding:0 1px}\n',
    'probe.json': '{"message":"hello"}\n',
    'probe.jsonc': '// Keep comments\n{"message":"hello"}\n',
  }
  const preserved = {
    'contracts/generated/probe.ts': 'export const generated={value:1};\n',
    'contracts/vectors/probe.json': '{"exact":true}\n',
    'intake-server/tests/fixtures/probe.json': '{"exact":true}\n',
    'docs/bench-intake/reference/original.html': '<div>  original </div>\n',
    'docs/bench-intake/reference/original.json': '{"exact":true}\n',
    'intake-server/migrations/0001_foundation.sql': '-- immutable\nSELECT  1;\n',
    '.claude/worktrees/probe/probe.ts': 'export const local={value:1};\n',
    '.amp/in/artifacts/probe.json': '{"exact":true}\n',
    'probe.md': `# Heading\n\n${'Unwrapped prose. '.repeat(30).trim()}\n`,
    'probe.py': 'value={"hello":1}\n',
    'probe.yaml': 'key:  value\n',
  }
  for (const [file, value] of Object.entries({ ...code, ...preserved })) write(file, value)
  run('pnpm', ['format:check'], 1)
  run('pnpm', ['format'])
  const formatted = Object.fromEntries(Object.keys(code).map((file) => [file, read(file)]))
  for (const file of Object.keys(code)) assert.notEqual(formatted[file], code[file], file)
  run('pnpm', ['format:check'])
  run('pnpm', ['format'])
  // Explicit CLI paths (as passed by hooks/editors) must not bypass the ignore policy.
  run('pnpm', ['exec', 'prettier', '--write', ...Object.keys(preserved)])
  for (const [file, value] of Object.entries(formatted)) assert.equal(read(file), value, file)
  for (const [file, value] of Object.entries(preserved)) assert.equal(read(file), value, file)
  write('invalid.ts', 'export const broken = {\n')
  run('pnpm', ['format:check'], 2)
})

test('real hooks report rewrites without staging them, then pass after explicit staging', (t) => {
  const { run, write, read, git } = fixture(t)
  const before = {
    'probe.tsx': 'export const View=()=> <div>Hello</div>;\n',
    'probe.cjs': 'module.exports={message:"hello"};\n',
    'probe.css': '.test{color:red}\n',
    'probe.json': '{"message":"hello"}\n',
    'probe.py': 'value={"hello":1}\n',
    'probe.md': `# Heading\n\n${'Unwrapped prose. '.repeat(30).trim()}\n`,
    'contracts/generated/probe.json': '{"exact":true}\n',
    'docs/bench-intake/reference/original.py': 'value={"exact":True}\n',
  }
  for (const [file, value] of Object.entries(before)) write(file, value)
  git('add', '--', ...Object.keys(before))
  // This is a disposable standalone repository, not any shared Git worktree.
  assert.equal(git('rev-parse', '--git-common-dir').trim(), '.git')
  run('pnpm', ['hooks:install'])
  run('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'test: formatting hook'], 1)
  for (const file of ['probe.tsx', 'probe.cjs', 'probe.css', 'probe.json', 'probe.py']) {
    assert.notEqual(read(file), before[file], file)
    assert.equal(git('show', `:${file}`), before[file], `must not stage ${file}`)
  }
  assert.equal(read('probe.md'), before['probe.md'], 'remark must not hard-wrap prose')
  assert.equal(read('contracts/generated/probe.json'), before['contracts/generated/probe.json'])
  assert.equal(
    read('docs/bench-intake/reference/original.py'),
    before['docs/bench-intake/reference/original.py'],
  )
  git('add', '--', ...Object.keys(before))
  run('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'test: formatting hook'])
  run('pnpm', ['format:python:check', 'probe.py'])
  const python = read('probe.py')
  run('pnpm', ['format:python', 'probe.py'])
  assert.equal(read('probe.py'), python)
})

test('partial staging is preserved and malformed code fails the actual hook', (t) => {
  const { write, read, git, hook } = fixture(t)
  const staged = 'module.exports = { message: "staged" };\n'
  const unstaged = '// Unstaged work stays outside the index.\n'
  write('probe.cjs', staged)
  git('add', 'probe.cjs')
  write('probe.cjs', staged + unstaged)
  hook('prettier', 1)
  assert.equal(git('show', ':probe.cjs'), staged)
  assert.ok(read('probe.cjs').includes(unstaged))
  // pre-commit may roll back fixes when the unstaged patch conflicts; either way no work is lost.
  write('probe.cjs', "module.exports = { message: 'staged' }\n")
  git('add', 'probe.cjs')
  write('probe.cjs', read('probe.cjs') + unstaged)
  hook('prettier')
  assert.equal(git('show', ':probe.cjs'), "module.exports = { message: 'staged' }\n")
  assert.ok(read('probe.cjs').endsWith(unstaged))
  write('broken.tsx', 'export const View = () => <div>\n')
  git('add', 'broken.tsx')
  hook('prettier', 1)
})

test('large-file exception admits only the preserved original table screenshot', (t) => {
  const { write, git, hook } = fixture(t)
  const original = 'docs/bench-intake/reference/07-table.png'
  const adjacent = 'docs/bench-intake/reference/08-table.png'
  const content = 'x'.repeat(512_001)
  write(original, content)
  git('add', '--', original)
  hook('check-added-large-files')
  write(adjacent, content)
  git('add', '--', adjacent)
  const output = hook('check-added-large-files', 1)
  assert.ok(output.includes(adjacent), 'adjacent large reference must still be rejected')
})

test('shared readability hook rejects missing separation without rewriting or staging source', (t) => {
  const { run, write, read, git, hook } = fixture(t)
  const source = 'frontend/src/probe.ts'
  const condensed = 'export function first() {}\nexport function second() {}\n'
  write(source, condensed)
  write('intake-server/src/probe.ts', 'export const value = 1\n')
  write('contracts/src/probe.ts', 'export const value = 1\n')
  const preserved = 'export const exactProtocol = {\n'
  write('intake-server/src/fixtures/protocol.ts', preserved)
  write('contracts/src/generated/protocol.ts', preserved)
  git('add', source)
  const output = hook('eslint-readability', 1)
  assert.ok(output.includes('padding-line-between-statements'))
  assert.equal(read(source), condensed)
  assert.equal(git('show', ':' + source), condensed)
  run('pnpm', ['format:readability'])
  run('pnpm', ['format'])
  assert.equal(read(source), 'export function first() {}\n\nexport function second() {}\n')
  assert.equal(git('show', ':' + source), condensed, 'formatter must not stage its changes')
  git('add', source)
  hook('eslint-readability')
  assert.equal(read('intake-server/src/fixtures/protocol.ts'), preserved)
  assert.equal(read('contracts/src/generated/protocol.ts'), preserved)
})
