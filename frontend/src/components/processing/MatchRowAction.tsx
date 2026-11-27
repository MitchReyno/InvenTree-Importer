import type { MatchLotDto } from '@invimport/contracts'
import { Button } from '#/components/ui'
import { batchHref } from '#/navigation/batch-route'

/** A row's one action: answer its open question, search again, or decide again. */
export function MatchRowAction({
  batchId,
  label,
  match,
  unavailableReason,
  busy,
  searchAgain,
  decideAgain,
}: {
  batchId: string
  label: string
  match: MatchLotDto
  unavailableReason?: string
  busy: boolean
  searchAgain: (lotId: string) => void
  decideAgain: (lotId: string) => void
}) {
  if (match.state === 'question' && match.question_id) {
    return (
      <Button
        as="a"
        variant="primary"
        size="sm"
        aria-label={`Answer: ${label}`}
        href={batchHref(batchId, {
          tab: 'processing',
          step: 'match',
          questionId: match.question_id,
        })}
      >
        Answer
      </Button>
    )
  }
  if (match.state === 'decided' || match.state === 'held') {
    return (
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Change: ${label}`}
        busy={busy}
        disabledReason={unavailableReason}
        reasonDisplay="quiet"
        onClick={() => decideAgain(match.lot_id)}
      >
        Change
      </Button>
    )
  }
  if (match.state === 'clear' || match.state === 'unavailable') {
    return (
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Search again: ${label}`}
        busy={busy}
        disabledReason={unavailableReason}
        reasonDisplay="quiet"
        onClick={() => searchAgain(match.lot_id)}
      >
        Search again
      </Button>
    )
  }

  return null
}
