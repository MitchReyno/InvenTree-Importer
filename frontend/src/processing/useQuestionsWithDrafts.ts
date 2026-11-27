import { useState } from 'react'
import type { SessionHistoryEntryDto } from '@invimport/contracts'
import type { HeldHistory } from './session-history'

type Entry = SessionHistoryEntryDto

/** Places entries into a newest-first list by time, after any entry at the same time. */
function insertByTime(entries: readonly Entry[], extra: readonly Entry[]) {
  const merged = [...entries]
  for (const entry of extra) {
    const at = merged.findIndex((candidate) => candidate.at < entry.at)
    merged.splice(at === -1 ? merged.length : at, 0, entry)
  }
  return merged
}

/**
 * The held entries, plus any question entry this page has shown whose answer form still holds an
 * unsaved draft but which a refresh dropped (more than a page of new entries arrived). Its card
 * keeps its key, so the form and its draft stay mounted.
 */
export function useQuestionsWithDrafts(
  held: HeldHistory | undefined,
  isAnswerDirty: (questionId: string) => boolean,
) {
  const [seen, setSeen] = useState<ReadonlyMap<string, Entry>>(() => new Map())
  const current = held?.entries ?? []
  const unseen = current.filter(
    (entry) => entry.details.kind === 'question' && seen.get(entry.id) !== entry,
  )
  if (unseen.length > 0) {
    // Remembered during render, so a dropped question is still known on the next read.
    setSeen(new Map([...seen, ...unseen.map((entry) => [entry.id, entry] as const)]))
  }
  const present = new Set(current.map((entry) => entry.id))
  const kept = [...seen.values()].filter(
    (entry) =>
      !present.has(entry.id) &&
      entry.details.kind === 'question' &&
      isAnswerDirty(entry.details.question_id),
  )
  return { entries: kept.length > 0 ? insertByTime(current, kept) : current }
}
