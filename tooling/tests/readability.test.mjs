import assert from 'node:assert/strict'
import { ESLint } from 'eslint'
import { format } from 'prettier'
import test from 'node:test'
import readability from '../eslint/readability.mjs'

function checker(fix = false) {
  return new ESLint({ overrideConfigFile: true, overrideConfig: [readability], fix })
}

async function inspect(source, fix = false) {
  const [result] = await checker(fix).lintText(source, { filePath: 'probe.ts' })
  return result
}

async function assertRule(source, rule) {
  const result = await inspect(source)
  assert.ok(
    result.messages.some((message) => message.ruleId === rule),
    result.messages,
  )
}

test('separates ordinary, exported, nested and arrow/function-expression declarations', async () => {
  const declarations = [
    'function first() {}\nfunction second() {}\n',
    'export function first() {}\nexport function second() {}\n',
    'const first = () => {}\nconst second = function () {}\n',
    'export const first = () => {}\nexport const second = function () {}\n',
    'function outer() {\nconst value = 1\nfunction inner() {}\nreturn value\n}\n',
  ]
  for (const source of declarations) {
    await assertRule(source, '@stylistic/padding-line-between-statements')
    const fixed = await inspect(source, true)
    assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages))
    assert.equal((await inspect(fixed.output ?? source)).errorCount, 0)
  }
})

test('separates class methods without forcing blank lines between related fields', async () => {
  const source = 'class Worker {\nfirst = 1\nsecond = 2\nrun() {}\nstop() {}\n}\n'
  await assertRule(source, '@stylistic/lines-between-class-members')
  const fixed = await inspect(source, true)
  assert.equal(fixed.errorCount, 0)
  assert.ok(fixed.output.includes('first = 1\nsecond = 2'))
  assert.ok(fixed.output.includes('run() {}\n\nstop() {}'))
})

test('requires branch braces and one variable per declaration', async () => {
  const source = 'const first = 1, second = 2\nif (first) console.log(second)\n'
  await assertRule(source, 'one-var')
  await assertRule(source, 'curly')
  const fixed = await inspect(source, true)
  assert.equal(fixed.errorCount, 0)
  assert.match(fixed.output, /const first = 1[;\n]/)
  assert.match(fixed.output, /const second = 2/)
  assert.match(fixed.output, /if \(first\) \{/)
})

test('keeps function and class overload groups with their implementations', async () => {
  const source = `function convert(value: string): string
function convert(value: number): string
function convert(value: string | number) { return String(value) }

class Reader {
  read(value: string): string
  read(value: number): string
  read(value: string | number) { return String(value) }

  close() {}
}
`
  const result = await inspect(source)
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages))
})

test('keeps exported overload signatures together', async () => {
  const source = `export function read(value: string): string
export function read(value: number): string
export function read(value: string | number) { return String(value) }
`
  const result = await inspect(source)
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages))
})

test('a maintained-rule fix remains stable through the configured Prettier style', async () => {
  const source =
    'export function first(){if(true)return 1;return 2}\nexport function second(){return 3}\n'
  const result = await inspect(source, true)
  const formatted = await format(result.output, {
    parser: 'typescript',
    singleQuote: true,
    semi: false,
    printWidth: 100,
  })
  assert.equal((await inspect(formatted)).errorCount, 0)
  const repeated = await inspect(formatted, true)
  assert.equal(repeated.output, undefined)
  assert.equal(
    await format(formatted, {
      parser: 'typescript',
      singleQuote: true,
      semi: false,
      printWidth: 100,
    }),
    formatted,
  )
})

test('object methods stay an explicit review requirement, without pretending class rules cover them', async () => {
  const source = 'const worker = {\nrun() {},\nstop() {},\n}\n'
  assert.equal((await inspect(source)).errorCount, 0)
})
