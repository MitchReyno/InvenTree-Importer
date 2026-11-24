import { describe, expect, it } from 'vitest'
import { chat, history, status } from '#/test/session-history'
import { unreadPendingSends, type PendingSend } from './pending-sends'

const send = (key: string, text: string, extra: Partial<PendingSend> = {}): PendingSend => ({
  key,
  text,
  after: 2,
  status: 'sending',
  ...extra,
})

describe('unreadPendingSends', () => {
  it('matches each newer chat row to one send, so a second identical send stays shown', () => {
    const entries = history([
      chat(3, 3, 'Again?'),
      chat(2, 2, 'Earlier'),
      status(1, 1, 'x'),
    ]).entries
    const shown = unreadPendingSends([send('a', 'Again?'), send('b', 'Again?')], entries)
    expect(shown.map((item) => item.key)).toEqual(['b'])
  })

  it('shows a saved send only while the read is older than its row', () => {
    const saved = send('a', 'Hello', { status: 'saved', seq: 3 })
    const older = history([chat(2, 2, 'Earlier')]).entries
    // A surface whose read predates the row, such as a stale session page, still shows it.
    expect(unreadPendingSends([saved], older)).toEqual([saved])
    const holding = history([chat(3, 3, 'Hello'), chat(2, 2, 'Earlier')]).entries
    expect(unreadPendingSends([saved], holding)).toEqual([])
    // Once the newest page has rolled past the row, it never returns.
    const rolled = history([chat(9, 9, 'Later'), status(1, 1, 'x')]).entries
    expect(unreadPendingSends([saved], rolled)).toEqual([])
  })

  it('leaves an unconfirmed send to the message box', () => {
    expect(unreadPendingSends([send('a', 'Hi', { status: 'unconfirmed' })], [])).toEqual([])
  })
})
