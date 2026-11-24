import { describe, expect, it } from 'vitest'
import {
  appendOlderPage,
  chatMessages,
  citedSources,
  conversation,
  drawerItems,
  mergeNewestPage,
  viewedPhotos,
} from './session-history'
import {
  attemptHeader,
  at,
  chat,
  H,
  history,
  input,
  observation,
  photoView,
  proposal,
  question,
  reply,
  status,
} from '#/test/session-history'

const ids = (items: { id: string }[]) => items.map((item) => item.id)

describe('refreshing the newest page', () => {
  const older = [status(3, 3, 'three'), status(2, 2, 'two'), status(1, 1, 'one')]

  it('keeps loaded older entries, replacing those the new page holds, without duplicates', () => {
    const first = mergeNewestPage(undefined, history(older.slice(0, 2), { before: 'c2' }))
    const loaded = appendOlderPage(first, history(older.slice(2)), 'c2')
    const changed = status(3, 3, 'three, now resolved again')
    const refreshed = mergeNewestPage(
      loaded,
      history([status(4, 4, 'four'), changed], { before: 'c3' }),
    )

    expect(ids(refreshed.entries)).toEqual(ids([status(4, 4, ''), ...older]))
    expect(refreshed.entries[1].summary).toBe('three, now resolved again')
    // Older pages were loaded to the start, so nothing remains to load.
    expect(refreshed.before).toBeUndefined()
  })

  it('keeps the entry one new entry pushed off the newest page', () => {
    const first = mergeNewestPage(undefined, history(older.slice(0, 2), { before: 'c2' }))
    const refreshed = mergeNewestPage(
      first,
      history([status(4, 4, 'four'), older[0]], { before: 'c3' }),
    )

    expect(ids(refreshed.entries)).toEqual(ids([status(4, 4, ''), older[0], older[1]]))
    expect(refreshed.before).toBe('c2')
  })

  it('drops older entries when more than a page arrived, and Load older continues from it', () => {
    const first = mergeNewestPage(undefined, history(older, {}))
    const burst = [status(6, 6, 'six'), status(5, 5, 'five')]
    const refreshed = mergeNewestPage(first, history(burst, { before: 'c5' }))

    expect(ids(refreshed.entries)).toEqual(ids(burst))
    expect(refreshed.before).toBe('c5')
  })

  it('ignores an older page read from a cursor the held entries no longer end at', () => {
    const first = mergeNewestPage(undefined, history(older.slice(0, 2), { before: 'c2' }))
    const burst = mergeNewestPage(first, history([status(9, 9, 'nine')], { before: 'c9' }))

    expect(appendOlderPage(burst, history(older.slice(2)), 'c2')).toBe(burst)
  })

  it('takes the newest metadata on every read', () => {
    const first = mergeNewestPage(undefined, history(older))
    const failed = attemptHeader({ state: 'failed', session_state: 'failed' })
    const refreshed = mergeNewestPage(first, history(older, { attempts: [failed] }))

    expect(refreshed.session.attempts[0].state).toBe('failed')
  })

  it('measures the newest page by its stored rows, not the web reads derived from them', () => {
    const cited = proposal(4, 4)
    const first = mergeNewestPage(undefined, history([...cited, older[0]], { before: 'c3' }))
    const refreshed = mergeNewestPage(
      first,
      history([status(5, 5, 'five'), ...cited], { before: 'c4' }),
    )

    expect(ids(refreshed.entries)).toEqual(ids([status(5, 5, ''), ...cited, older[0]]))
  })
})

describe('the drawer', () => {
  it('groups consecutive observations in one photo, and keeps other photos apart', () => {
    const entries = [
      observation(4, 4, { id: H.proposal, evidence: H.evidence2, version: H.version2 }),
      observation(3, 3, { id: H.part, text: 'LED' }),
      observation(2, 2, { id: H.failure, text: '16.000' }),
      observation(1, 1),
    ]
    const items = drawerItems(entries)

    expect(items.map((item) => item.summary)).toEqual([
      'Recorded 3 observations in Bench bag spill',
      'Recorded an observation in Bench bag spill',
    ])
    expect(items[0].kind === 'group' && items[0].entries).toHaveLength(3)
  })

  it('folds a run of photo views and web reads into one line, and leaves chat to the chat', () => {
    const entries = [
      ...proposal(6, 6, {
        pages: ['https://a.example/1', 'https://b.example/2', 'https://c.example/3'],
      }),
      photoView(5, 5),
      photoView(4, 4, { evidence: H.evidence2, version: H.version2 }),
      chat(1, 3, 'Check the PB datasheet'),
      ...proposal(2, 2, { pages: [] }),
    ]
    const items = drawerItems(entries)

    expect(items.map((item) => item.summary)).toEqual([
      'Proposed ATmega328P-AU',
      'Read 3 web pages · viewed 2 photos',
      'Proposed ATmega328P-AU',
    ])
    expect(items[1].kind).toBe('elided')
  })

  it('says one photo or one page in the singular', () => {
    const items = drawerItems([photoView(2, 2), ...proposal(1, 1).slice(1)])

    expect(items.map((item) => item.summary)).toEqual(['Read 1 web page · viewed 1 photo'])
  })
})

describe('the session page', () => {
  const first = attemptHeader({
    state: 'failed',
    session_state: 'failed',
    ended: { at: at(9), source: 'transition' },
  })
  const second = attemptHeader({
    id: H.attempt2,
    number: 2,
    queued_at: at(10),
    started_because: null,
  })

  it('reads as one conversation in time order with a divider for each attempt', () => {
    const entries = [
      status(1, 11, 'Checking again', { attempt: 2, id: `outbox:${H.attempt2}:1` }),
      input(
        3,
        8,
        { kind: 'revision', fields: ['identity'], reason: 'Top marking reads ATMEGA328PB' },
        { who: 'app' },
      ),
      reply(3, 7, 'Will do.'),
      chat(2, 6, 'Can you check the marking?'),
      question(2, 4),
      ...proposal(1, 3).slice(1),
    ]
    const held = mergeNewestPage(undefined, history(entries, { attempts: [first, second] }))
    const items = conversation(held, 'all')

    expect(
      items.map((item) =>
        item.kind === 'attempt' ? `Attempt ${item.attempt.number}` : item.summary,
      ),
    ).toEqual([
      'Attempt 1',
      'Read ww1.microchip.com',
      'Asked: Which ATmega328P variant is this?',
      'Can you check the marking?',
      'Replied: Will do.',
      'Input revision 3',
      'Attempt 2',
      'Checking again',
    ])
  })

  it('filters to messages, your inputs, photos or web', () => {
    const entries = [
      photoView(4, 5),
      reply(3, 4, 'Sure.'),
      chat(2, 3, 'Hi'),
      input(1, 2, {
        kind: 'instruction',
        instruction_id: H.instruction,
        text: 'Prefer datasheets',
        group_id: null,
        saved_at: at(0),
        relayed: false,
      }),
      ...proposal(2, 1).slice(1),
    ]
    const held = mergeNewestPage(undefined, history(entries))

    const summaries = (filter: Parameters<typeof conversation>[1]) =>
      conversation(held, filter).flatMap((item) => (item.kind === 'attempt' ? [] : [item.summary]))

    expect(summaries('messages')).toEqual(['Hi', 'Replied: Sure.'])
    expect(summaries('inputs')).toEqual(['Input instruction 1', 'Hi'])
    expect(summaries('photos')).toEqual(['Prepared part of MCU close-up for the agent'])
    expect(summaries('web')).toEqual(['Read ww1.microchip.com'])
  })

  it('shows a divider only where its attempt starts within the loaded entries', () => {
    const held = mergeNewestPage(
      undefined,
      history([status(1, 11, 'Later', { attempt: 2, id: `outbox:${H.attempt2}:1` })], {
        attempts: [first, second],
        before: 'c1',
      }),
    )

    expect(conversation(held, 'all').map((item) => item.kind)).toEqual(['attempt', 'entry'])
  })

  it('lists the photos it viewed and the sources it cited, once each', () => {
    const entries = [photoView(3, 3), photoView(2, 2), ...proposal(1, 1)]

    expect(viewedPhotos(entries)).toEqual([
      expect.objectContaining({ label: 'MCU close-up', views: 2 }),
    ])
    expect(citedSources(entries).map((source) => source.label)).toEqual([
      'MCU close-up',
      'ww1.microchip.com',
    ])
  })

  it('takes chat bubbles from the operator’s messages and the agent’s replies', () => {
    const messages = chatMessages([reply(2, 3, 'Yes'), chat(1, 2, 'Hello')])

    expect(messages).toEqual([
      { id: 'inbox:1', who: 'You', mine: true, text: 'Hello' },
      { id: `outbox:${H.attempt}:2`, who: 'Agent', mine: false, text: 'Yes' },
    ])
  })
})
