import styled from 'styled-components'
import { Banner, Button, EventTime, Paragraph } from '#/components/ui'
import type { UnsavedChange } from '#/navigation/unsaved-changes'
import { space } from '#/theme/generated/tokens'

interface SavedValuesNoticeProps {
  /** When the values shown were read or saved. */
  shownAt: number
  /** Whether anything is unsaved, named or not. */
  dirty: boolean
  /** The unsaved changes their editors name and can drop. */
  unsaved: readonly UnsavedChange[]
  onTryNow: () => void
  onDiscard: () => void
}

/** Saved values can't be read: nothing is lost, so it is amber, and it names only real changes. */
export function SavedValuesNotice({
  shownAt,
  dirty,
  unsaved,
  onTryNow,
  onDiscard,
}: SavedValuesNoticeProps) {
  const named = unsaved.length > 0

  return (
    <div role="status">
      <Banner
        tone="warn"
        action={
          <Actions>
            <Button size="sm" onClick={onTryNow}>
              Try now
            </Button>
            {named && (
              <Button size="sm" variant="ghost" onClick={onDiscard}>
                Discard my changes
              </Button>
            )}
          </Actions>
        }
      >
        <Paragraph>
          <strong>Couldn’t load the latest values.</strong>{' '}
          {named && (
            <>
              Your unsaved changes to <ChangeList changes={unsaved} /> are kept.
            </>
          )}
          {!named && dirty && 'Your unsaved changes are kept. Trying again…'}
          {!dirty && (
            <>
              Showing what was loaded at{' '}
              <EventTime at={new Date(shownAt).toISOString()} clockToday />. Trying again…
            </>
          )}
        </Paragraph>
      </Banner>
    </div>
  )
}

/** "A", "A and B", "A, B and C", each in bold; repeated labels are named once. */
function ChangeList({ changes }: { changes: readonly UnsavedChange[] }) {
  const labels = [...new Set(changes.map((change) => change.label))]

  return labels.map((label, index) => {
    let separator = ''
    if (index > 0) {
      separator = index === labels.length - 1 ? ' and ' : ', '
    }
    return (
      <span key={label}>
        {separator}
        <strong>{label}</strong>
      </span>
    )
  })
}

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[4]};
`
