import type { ProcessingQuestionDto } from '@invimport/contracts'

/**
 * Why a pinned answer form can or can't send, from the current read and the form's own confirmed
 * answer. Only `open` and `context_moved` questions are still open.
 */
export type QuestionStanding =
  | 'open'
  | 'context_moved'
  | 'answered_here'
  | 'answered_elsewhere'
  | 'replaced'
  | 'closed'
  | 'gone'

export type StandingInput = {
  /** The question as the form pinned it, with the capture revision it was pinned at. */
  pinned: ProcessingQuestionDto
  pinnedCaptureRevision: string
  /** The same question in the latest read; undefined once it has left the read. */
  current: ProcessingQuestionDto | undefined
  currentCaptureRevision: string
  /** This form's own answer was confirmed. */
  answeredHere: boolean
}

export function questionStanding({
  pinned,
  pinnedCaptureRevision,
  current,
  currentCaptureRevision,
  answeredHere,
}: StandingInput): QuestionStanding {
  if (answeredHere) {
    return 'answered_here'
  }
  if (!current || current.id !== pinned.id) {
    return 'gone'
  }
  if (current.state === 'answered') {
    return 'answered_elsewhere'
  }
  if (current.state !== 'open') {
    return current.replaced_by ? 'replaced' : 'closed'
  }
  // A question's attempt and input never change; a moved revision means it closed and reopened.
  const sameQuestion =
    current.revision === pinned.revision &&
    current.attempt_id === pinned.attempt_id &&
    current.input_sha256 === pinned.input_sha256
  if (!sameQuestion) {
    return 'closed'
  }

  return currentCaptureRevision === pinnedCaptureRevision ? 'open' : 'context_moved'
}

/** A form can send a new answer only while its question is open at the revision it pinned. */
export function canSendNew(standing: QuestionStanding) {
  return standing === 'open'
}

/** The warning a form with an unsaved draft or an unconfirmed retry shows, if any. */
export function standingWarning(standing: QuestionStanding, retrying: boolean) {
  switch (standing) {
    case 'open':
    case 'answered_here':
      return null
    case 'context_moved':
      return retrying
        ? 'The saved question context changed. Try again sends only the original unconfirmed answer; discard clears only the local draft.'
        : 'Its saved context changed since you started. Your unsaved answer is kept; discard it to answer again with the current context.'
    case 'answered_elsewhere':
      return retrying
        ? 'This question is answered now. Try again sends only your original answer, which the server keeps once.'
        : 'Answered elsewhere; your unsaved answer can’t be sent.'
    case 'replaced':
    case 'closed':
    case 'gone':
      return retrying
        ? 'The saved question context changed. Try again sends only the original unconfirmed answer; discard clears only the local draft.'
        : 'This question is superseded or its saved context changed. Your unsaved answer is preserved; it cannot be applied to another question.'
  }
}
