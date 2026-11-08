import { describe, expect, it } from 'vitest'
import {
  batchHref,
  batchRouteHash,
  pageWidthFor,
  parseBatchRoute,
  sessionFromQuery,
  sessionHref,
} from './batch-route'

const b = 'b0000000-0000-4000-8000-000000000001'
const lot = 'a0000000-0000-4000-8000-00000000000a'
const p = 'p0000000-0000-4000-8000-00000000000p'
const r = 'r0000000-0000-4000-8000-00000000000r'
const q = 'q0000000-0000-4000-8000-00000000000q'

function redirect(route: string) {
  const parsed = parseBatchRoute(route)
  return parsed.kind === 'redirect' ? parsed.to : null
}

describe('legacy batch links redirect to the new routes', () => {
  it.each([
    [`${b}/approve`, `${b}/changes/ready`],
    [`${b}/approve/${p}`, `${b}/changes/ready/${p}`],
    [`${b}/results`, `${b}/changes/added`],
    [`${b}/results/${r}`, `${b}/changes/added/${r}`],
    [`${b}/review`, `${b}/review/lots`],
    [`${b}/review/${lot}`, `${b}/review/lots/${lot}`],
    [`${b}/processing`, `${b}/processing/overview`],
    [`${b}/processing/reading`, `${b}/processing/examine`],
    [`${b}/processing/identifying/${q}`, `${b}/processing/examine/${q}`],
    [`${b}/processing/reading/${q}`, `${b}/processing/examine/${q}`],
  ])('%s → %s', (from, to) => {
    expect(redirect(from)).toBe(to)
  })

  it('keeps the whole query string, including pinned evidence and the open editor', () => {
    const query = `?source=S&version=V&page=2&preview=1&filter=blocked&edit=${lot}`

    expect(redirect(`${b}/review/${lot}${query}`)).toBe(`${b}/review/lots/${lot}${query}`)
    expect(redirect(`${b}/approve/${p}?x=1`)).toBe(`${b}/changes/ready/${p}?x=1`)
    expect(redirect(`${b}/processing/identifying/${q}?a=b`)).toBe(
      `${b}/processing/examine/${q}?a=b`,
    )
  })

  it('does not redirect review sub-views that are already new', () => {
    expect(redirect(`${b}/review/lots`)).toBeNull()
    expect(redirect(`${b}/review/map`)).toBeNull()
    expect(redirect(`${b}/review/records`)).toBeNull()
  })
})

describe('new batch routes', () => {
  it.each([
    [`${b}`, { tab: 'capture' }],
    [`${b}/capture`, { tab: 'capture' }],
    [`${b}/processing/overview`, { tab: 'processing', step: 'overview' }],
    [`${b}/processing/research/${q}`, { tab: 'processing', step: 'research', questionId: q }],
    [`${b}/review/lots`, { tab: 'review', view: 'lots' }],
    [`${b}/review/lots/${lot}?view=table`, { tab: 'review', view: 'lots', lotId: lot }],
    [`${b}/review/map`, { tab: 'review', view: 'map' }],
    [
      `${b}/review/records/company/7`,
      { tab: 'review', view: 'records', recordType: 'company', recordId: '7' },
    ],
    [
      `${b}/review/records/tag/1%2F4W%20Bin`,
      { tab: 'review', view: 'records', recordType: 'tag', recordId: '1/4W Bin' },
    ],
    [`${b}/changes/ready/${p}`, { tab: 'changes', view: 'ready', preparationId: p }],
    [`${b}/changes/added/${r}`, { tab: 'changes', view: 'added', runId: r }],
    [`${b}/changes`, { tab: 'changes', view: 'ready' }],
  ])('%s', (hash, route) => {
    const parsed = parseBatchRoute(hash)

    expect(parsed).toMatchObject({ kind: 'route', batchId: b, route })
  })

  it('treats an unknown segment as Capture so former subject links can still be resolved', () => {
    expect(parseBatchRoute(`${b}/${lot}`)).toMatchObject({
      kind: 'route',
      route: { tab: 'capture' },
      legacySubject: lot,
    })
  })

  it('builds hashes that parse back to the same route', () => {
    const routes = [
      { tab: 'capture' },
      { tab: 'processing', step: 'examine', questionId: q },
      { tab: 'review', view: 'lots', lotId: lot },
      { tab: 'review', view: 'records', recordType: 'part' },
      { tab: 'changes', view: 'ready', preparationId: p },
      { tab: 'changes', view: 'added' },
    ] as const

    for (const route of routes) {
      expect(parseBatchRoute(batchRouteHash(b, route))).toMatchObject({ kind: 'route', route })
    }
    expect(batchRouteHash(b, { tab: 'review', view: 'lots', lotId: lot }, '?view=table')).toBe(
      `${b}/review/lots/${lot}?view=table`,
    )
  })
})

it('encodes a record id so it reads back the same', () => {
  const route = { tab: 'review', view: 'records', recordType: 'tag', recordId: '1/4W Bin' } as const
  const hash = batchHref('10000000-0000-4000-8000-000000000001', route).slice(1)
  expect(parseBatchRoute(hash)).toMatchObject({ kind: 'route', route })
})

describe('each page takes its design width', () => {
  it.each([
    ['', 'content'],
    [`${b}/capture`, 'content'],
    [`${b}/processing/research`, 'content'],
    [`${b}/changes/ready`, 'content'],
    [`${b}/review/lots`, 'review'],
    [`${b}/review/map`, 'review'],
    [`${b}/review/records/part`, 'review'],
    [`${b}/review`, 'review'],
  ])('%s → %s', (route, width) => {
    expect(pageWidthFor(route)).toBe(width)
  })
})

describe('session links', () => {
  it('opens a session on its step through a query the batch reads back', () => {
    const href = sessionHref('b', 'research', 'job 1')
    expect(href).toBe('#b/processing/research?session=job%201')
    const parsed = parseBatchRoute(href.slice(1))
    expect(parsed.kind === 'route' && sessionFromQuery(parsed.query)).toBe('job 1')
    expect(sessionFromQuery('')).toBeNull()
  })
})
