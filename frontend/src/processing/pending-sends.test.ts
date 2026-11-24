import { afterEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { chat, history, status } from '#/test/session-history'
import { createServerQueryClient } from '#/queries/client'
import { serverQueryKey, type ServerScope } from '#/queries/scope'
import {
  dropScopeSends,
  nextHistoryOrder,
  pendingSendKey,
  retireCoveredSends,
  settlePendingSend,
  startPendingSend,
  unreadPendingSends,
  usePendingSends,
  type PendingSend,
} from './pending-sends'

const send = (key: string, text: string, extra: Partial<PendingSend> = {}): PendingSend => ({
  key,
  text,
  after: 2,
  status: 'sending',
  ...extra,
})

const scope: ServerScope = {
  origin: 'http://127.0.0.1:4310',
  actorId: 'actor',
  targetId: 'target',
  targetContextId: 'context',
}
const session = { storeKey: pendingSendKey(scope, 'batch', 'job'), batchId: 'batch', jobId: 'job' }

const historyKey = (which: 'newest' | 'page') =>
  serverQueryKey(scope, 'processing', 'batch', 'history', 'job', which)

function heldSends() {
  return renderHook(() => usePendingSends(session.storeKey)).result.current
}

afterEach(() => dropScopeSends(scope))

describe('unreadPendingSends', () => {
  it('matches each newer chat row to one send, so a second identical send stays shown', () => {
    const read = history([chat(3, 3, 'Again?'), chat(2, 2, 'Earlier'), status(1, 1, 'x')])
    const shown = unreadPendingSends([send('a', 'Again?'), send('b', 'Again?')], read)
    expect(shown.map((item) => item.key)).toEqual(['b'])
  })

  it('shows a saved send only while the read is older than its row', () => {
    const saved = send('a', 'Hello', { status: 'saved', seq: 3, savedOrder: 10 })
    const older = history([chat(2, 2, 'Earlier')])
    // A surface whose read predates the row, such as a stale session page, still shows it.
    expect(unreadPendingSends([saved], { ...older, readOrder: 9 })).toEqual([saved])
    const holding = history([chat(3, 3, 'Hello'), chat(2, 2, 'Earlier')])
    expect(unreadPendingSends([saved], holding)).toEqual([])
    // Once the newest page has rolled past the row, it never returns.
    const rolled = history([chat(9, 9, 'Later'), status(1, 1, 'x')])
    expect(unreadPendingSends([saved], rolled)).toEqual([])
  })

  it('treats a read started after the receipt as covering a row pushed off by agent actions', () => {
    const saved = send('a', 'Hello', { status: 'saved', seq: 3, savedOrder: 10 })
    const actionsOnly = history([status(250, 30, 'Working'), status(249, 29, 'Working')])
    expect(unreadPendingSends([saved], { ...actionsOnly, readOrder: 9 })).toEqual([saved])
    expect(unreadPendingSends([saved], { ...actionsOnly, readOrder: 11 })).toEqual([])
  })

  it('leaves an unconfirmed send to the message box', () => {
    const read = history([])
    expect(unreadPendingSends([send('a', 'Hi', { status: 'unconfirmed' })], read)).toEqual([])
  })
})

describe('the send store', () => {
  it('keeps every saved send while a held read stays stale, and retires each once all reads cover it', () => {
    const client = createServerQueryClient()
    client.setQueryData(historyKey('newest'), { ...history([]), readOrder: nextHistoryOrder() })
    for (let index = 1; index <= 25; index += 1) {
      const item = send(`k${index}`, `Message ${index}`)
      startPendingSend(session, item)
      settlePendingSend(session.storeKey, {
        ...item,
        status: 'saved',
        seq: index,
        savedOrder: nextHistoryOrder(),
      })
    }
    retireCoveredSends(client, scope)
    expect(heldSends()).toHaveLength(25)

    // The drawer reads again; the session page's older copy is still held, so nothing goes yet.
    client.setQueryData(historyKey('page'), { ...history([]), readOrder: 0 })
    client.setQueryData(historyKey('newest'), { ...history([]), readOrder: nextHistoryOrder() })
    retireCoveredSends(client, scope)
    expect(heldSends()).toHaveLength(25)

    client.setQueryData(historyKey('page'), { ...history([]), readOrder: nextHistoryOrder() })
    retireCoveredSends(client, scope)
    expect(heldSends()).toHaveLength(0)
  })

  it('ignores a send that settles after its scope ended', () => {
    const item = send('late', 'Hello')
    startPendingSend(session, item)
    dropScopeSends(scope)
    settlePendingSend(session.storeKey, { ...item, status: 'unconfirmed' })
    settlePendingSend(session.storeKey, { ...item, status: 'saved', seq: 4, savedOrder: 1 })
    expect(heldSends()).toHaveLength(0)
  })

  it('keeps a saved send while a history read is in flight, even one with no data yet', async () => {
    const client = createServerQueryClient()
    client.setQueryData(historyKey('newest'), { ...history([]), readOrder: 0 })

    let land: (read: unknown) => void = () => {}

    const pageRead = client.fetchQuery({
      queryKey: historyKey('page'),
      queryFn: () =>
        new Promise((settle) => {
          land = settle
        }),
    })
    const item = send('k', 'Hello')
    startPendingSend(session, item)
    settlePendingSend(session.storeKey, {
      ...item,
      status: 'saved',
      seq: 3,
      savedOrder: nextHistoryOrder(),
    })
    client.setQueryData(historyKey('newest'), {
      ...history([chat(3, 3, 'Hello')]),
      readOrder: nextHistoryOrder(),
    })
    retireCoveredSends(client, scope)
    expect(heldSends()).toHaveLength(1)

    // The page's read started before the send and lands without the row: it still shows it.
    land({ ...history([chat(2, 2, 'Earlier')]), readOrder: 0 })
    await pageRead
    retireCoveredSends(client, scope)
    expect(heldSends()).toHaveLength(1)
  })

  it('starts a new send above the rows earlier sends were saved as, after they retire', () => {
    const client = createServerQueryClient()
    const first = send('first', 'Again?')
    startPendingSend(session, first)
    settlePendingSend(session.storeKey, {
      ...first,
      status: 'saved',
      seq: 9,
      savedOrder: nextHistoryOrder(),
    })
    const read = {
      ...history([chat(9, 9, 'Again?'), chat(2, 2, 'Earlier')]),
      readOrder: nextHistoryOrder(),
    }
    client.setQueryData(historyKey('newest'), read)
    retireCoveredSends(client, scope)
    expect(heldSends()).toHaveLength(0)

    // The second identical message is still sending; the first one's row is not its own.
    startPendingSend(session, send('second', 'Again?'))
    expect(unreadPendingSends(heldSends(), read).map((item) => item.key)).toEqual(['second'])
  })
})
