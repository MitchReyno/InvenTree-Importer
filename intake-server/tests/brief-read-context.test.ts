import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sealedContextNow } from '#/agents/tools/brief-read.ts'

const actor = '00000000-0000-4000-8000-0000000000a1'
const note = (id: string, text: string) => ({
  id,
  version: '1',
  text,
  actor_id: actor,
  created_at: '2026-11-25T00:00:00.000Z',
})
const kept = '00000000-0000-4000-8000-0000000000e1'
const removed = '00000000-0000-4000-8000-0000000000e2'
const live = '00000000-0000-4000-8000-0000000000c1'
const retired = '00000000-0000-4000-8000-0000000000c2'

test('a fallback to the sealed media notes leaves out removed evidence and retired groups', () => {
  const sealed = {
    groups: [
      { id: live, label: 'Shelf', note: note('00000000-0000-4000-8000-0000000000d1', 'Shelf') },
      { id: retired, label: 'Bin', note: note('00000000-0000-4000-8000-0000000000d2', 'Bin') },
    ],
    evidenceNotes: [
      { evidenceId: kept, note: note('00000000-0000-4000-8000-0000000000d3', 'Reel side') },
      { evidenceId: removed, note: note('00000000-0000-4000-8000-0000000000d4', 'Removed photo') },
    ],
  }
  const now = sealedContextNow(sealed, [kept], [live])
  assert.deepEqual(
    now.groups.map((group) => group.id),
    [live],
  )
  assert.deepEqual(
    now.evidenceNotes.map((item) => item.note.text),
    ['Reel side'],
  )
})
