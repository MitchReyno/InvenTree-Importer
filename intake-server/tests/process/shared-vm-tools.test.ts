import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { processingFixture } from '../support/processing.ts'
import { leadSession, lotSession } from '../support/sessions.ts'
import { startSessionToolServer } from '#/agents/tools/server.ts'
import { runSessionTurn, type SessionDriver } from '#/agents/session/session-runner.ts'
import { startSessionBridge } from '#/agents/shared-vm/coordinator.ts'

type Provider = 'claude' | 'codex'
type Fields = Map<string, string>
type Expectation = { name: string; holds: (fields: Fields) => boolean }

const PDF = 'https://www.rfc-editor.org/rfc/rfc9110.pdf'
// A private address: the proxy must refuse it even when public pages are allowed.
const PRIVATE = 'https://10.0.0.1/'
// Each outcome in its own status call keeps every report inside the status tool's length limit.
const REPORT =
  'Record each outcome below as key=value with its own intake status call. Write a failure as failed:<one lowercase word naming the error>.'
const FIELD = /\b(image|web|search|webfetch|private)=(\S+(?: (?![a-z]+=)\S+)*)/g

function toolsLine(provider: Provider) {
  if (provider === 'codex') {
    return 'Use functions.exec with image((await tools.view_image({path: imagePath})).image_url) and text(await tools.exec_command({cmd: command})), and your web_search tool.'
  }
  return 'Use Read, Write, Bash, WebSearch and WebFetch.'
}

/** The page the harness chose for WebFetch; its title stays out of the prompt. */
function fetchPage() {
  const rfc = process.env.INTAKE_TEST_FETCH_RFC ?? ''
  assert.match(rfc, /^9[5-6]\d\d$/)
  return `https://www.rfc-editor.org/rfc/rfc${rfc}.html`
}

/** The opt-in WebFetch step: Codex has no WebFetch, so its turns read pages with curl only. */
function fetchStep(provider: Provider, folder: string) {
  if (provider === 'codex') {
    return { text: '', status: '' }
  }
  return {
    text: `Use WebFetch on ${fetchPage()} and ask for the document's full title. Use Write to save the title WebFetch gives, unchanged, to ${folder}/title.txt. `,
    status: ', webfetch=ok:saved or failed:<word>',
  }
}

function parseFields(status: string) {
  const fields: Fields = new Map()
  for (const match of status.matchAll(FIELD)) {
    fields.set(match[1]!, match[2]!)
  }
  return fields
}

/** Every outcome the agent reported, in outbox order, a later report of a key winning. */
function reportedFields(statuses: readonly string[]) {
  const fields: Fields = new Map()
  for (const status of statuses) {
    for (const [key, value] of parseFields(status)) {
      fields.set(key, value)
    }
  }
  return fields
}

/** A searched URL's host, or null when the outcome names no valid URL. */
function searchHost(fields: Fields) {
  const url = /^ok:(https?:\/\/\S+)/.exec(fields.get('search') ?? '')?.[1]
  if (!url || !URL.canParse(url)) {
    return null
  }
  return new URL(url).hostname
}

/** What the run prints: checked values only, never a URL's path or credentials. */
function printableValue(key: string, value: string, fields: Fields) {
  if (key === 'image') {
    return /^[A-Z]{5}$/.test(value) ? value : '<other>'
  }
  if (key === 'search') {
    const host = searchHost(fields)
    if (host) {
      return `ok:${host}`
    }
    return value.startsWith('failed:') ? 'failed' : '<other>'
  }
  if (value.startsWith('failed:')) {
    return /^failed:[a-z_]{1,30}$/.test(value) ? value : 'failed'
  }
  if (key === 'webfetch') {
    return value.startsWith('ok:') ? 'ok' : '<other>'
  }
  return /^[a-z_]{1,40}$/.test(value) ? value : '<other>'
}

function printable(fields: Fields) {
  const shown: Record<string, string> = {}
  for (const [key, value] of fields) {
    shown[key] = printableValue(key, value, fields)
  }
  return JSON.stringify(shown)
}

/** A search outcome naming a URL whose host is ti.com or one of its subdomains. */
function searchFoundTi(fields: Fields) {
  const host = searchHost(fields)
  return host === 'ti.com' || Boolean(host?.endsWith('.ti.com'))
}

/** Web off: the existing image, script and refused-page checks, plus a refused WebFetch. */
function webOffTurn(provider: Provider, folder: string) {
  const fetch = fetchStep(provider, folder)
  return {
    text: `Inspect ${folder}/image.png visually with your built-in image reader and read its five capital letters. Write ${folder}/qualification.py and execute this Python script, which runs curl -sv https://www.rfc-editor.org/rfc/rfc9110.txt through the configured proxy, saves curl's complete output to ${folder}/web.txt, and reads the X-Bench-Refusal header the proxy answered with. ${fetch.text}${REPORT} Outcomes: image=<letters>, web=<refusal reason>${fetch.status}. Then stop.`,
    expected: (marker: string): Expectation[] => {
      const expected = [
        { name: 'image read', holds: (fields: Fields) => fields.get('image') === marker },
        {
          name: 'public page refused',
          holds: (fields: Fields) => fields.get('web') === 'destination_refused',
        },
      ]
      if (provider === 'claude') {
        expected.push({
          name: 'WebFetch failed',
          holds: (fields) => (fields.get('webfetch') ?? '').startsWith('failed:'),
        })
      }
      return expected
    },
  }
}

/** Web on: provider search, WebFetch where available, a curl PDF and a refused private target. */
function webOnTurn(provider: Provider, folder: string) {
  const fetch = fetchStep(provider, folder)
  return {
    text: `Search the web for the Texas Instruments LM358 datasheet and note the ti.com URL the results give. ${fetch.text}Write ${folder}/qualification.py and execute this Python script, which uses curl through the configured proxy to download ${PDF} to ${folder}/rfc9110.pdf, then runs curl -sv ${PRIVATE} and saves curl's complete output to ${folder}/private.txt. ${REPORT} Outcomes: search=ok:<the URL> or failed:<word>${fetch.status}, private=<X-Bench-Refusal value>. Then stop.`,
    expected: (): Expectation[] => {
      const expected = [
        { name: 'search found ti.com', holds: searchFoundTi },
        {
          name: 'private target refused',
          holds: (fields: Fields) => fields.get('private') === 'destination_refused',
        },
      ]
      if (provider === 'claude') {
        // The saved title is checked from the fixture against the page the harness read.
        expected.push({
          name: 'WebFetch read the page',
          holds: (fields) => (fields.get('webfetch') ?? '').startsWith('ok:'),
        })
      }
      return expected
    },
  }
}

// The caller stages a fresh synthetic picture and supplies its answer only to the assertion.
const web = process.env.INTAKE_TEST_TOOL_WEB === 'on'
// Examine is the batch-level session; research a lot's.
const examine = process.env.INTAKE_TEST_TOOL_STAGE === 'examine'
for (const provider of ['claude', 'codex'] as const) {
  test(
    `shared VM built-ins through the paired ${provider} subscription, ${examine ? 'examine' : 'research'}, web ${web ? 'on' : 'off'}`,
    {
      skip: process.env.INTAKE_TEST_TOOL_PROVIDER !== provider,
      timeout: 420000,
    },
    async (t) => {
      const fixtureName = process.env.INTAKE_TEST_TOOL_CASE
      assert.match(fixtureName ?? '', /^qualification\.[a-zA-Z0-9]{8}$/)
      const folder = '/home/node/sessions/' + fixtureName
      const marker = process.env.INTAKE_TEST_IMAGE_WORD
      assert.match(marker ?? '', /^[A-Z]{5}$/)
      const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
      t.after(() => fixture.dispose())
      const stateRoot = await mkdtemp(join(tmpdir(), 'bench-tool-test-'))
      t.after(() => rm(stateRoot, { recursive: true, force: true }))
      const server = await startSessionToolServer({
        pool: fixture.runner.pool,
        config: fixture.config,
        statusIntervalMs: 0,
      })
      t.after(() => server.close())
      const bridge = await startSessionBridge(
        process.env.INTAKE_VM_PAIR!,
        Number(process.env.INTAKE_VM_PORT),
        // The qualification turn reaches no deployment, so nothing needs protecting.
        { protectedHosts: [], confirmEvidence: server.confirmEvidence },
      )
      t.after(() => bridge.close())
      const capture = await fixture.seedCapture()
      const session = {
        state: 'queued',
        profile: {
          id: 'shared-vm-agent/3',
          agent: {
            provider,
            authentication: 'subscription',
            model: provider === 'claude' ? 'haiku' : 'gpt-6.1-sol',
          },
          settingsRevision: '1',
          // Off is an explicit saved choice; attempts sealed without a setting have unit tests.
          web: { public_pages: web, prefer_datasheets: web },
        },
      } as const
      const { attempt } = examine
        ? await leadSession(fixture, capture, session)
        : await lotSession(fixture, capture, capture.packetA, session)
      const turn = web ? webOnTurn(provider, folder) : webOffTurn(provider, folder)
      const driver: SessionDriver = (sessionTurn, context) =>
        bridge.driver(
          {
            ...sessionTurn,
            text: `Run this synthetic workspace qualification. ${toolsLine(provider)} The paths below are inside this guest. ${turn.text}`,
          },
          context,
        )
      const result = await runSessionTurn(
        {
          pool: fixture.runner.pool,
          config: fixture.config,
          host: { stateRoot, env: {}, claudeExecutable: '/unused', codexExecutable: '/unused' },
          toolUrl: server.url,
          drivers: { 'shared-vm-agent/3': driver },
        },
        attempt,
        AbortSignal.timeout(390000),
      )
      const failures = await fixture.db.pool.query(
        `SELECT diagnostic->>'code' AS code, diagnostic->>'stage' AS stage, diagnostic->'causes' AS causes
        FROM agent_session_failure WHERE attempt_id=$1`,
        [attempt],
      )
      assert.equal(result, 'finished', JSON.stringify(failures.rows))
      const messages = await fixture.db.pool.query(
        "SELECT payload->>'text' AS text FROM agent_session_outbox WHERE kind='status' AND session_id=$1 ORDER BY seq",
        [attempt],
      )
      const statuses = messages.rows.map((row) => String(row.text))
      const fields = reportedFields(statuses)
      // Only the parsed, redacted outcomes are printed, so the run's output can be summarised.
      console.log(`qualification outcomes: ${printable(fields)}`)
      for (const expectation of turn.expected(marker!)) {
        assert.ok(expectation.holds(fields), `${expectation.name}: ${printable(fields)}`)
      }
    },
  )
}
