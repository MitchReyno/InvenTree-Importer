import { Banner, Button } from '#/components/ui'

type Props = {
  reason: string
  onDismiss: () => void
}

/** Why dropped or pasted files were not added. */
export function RefusedFilesNotice({ reason, onDismiss }: Props) {
  return (
    <div role="status">
      <Banner
        tone="warn"
        action={
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        }
      >
        Files not added. {reason}
      </Banner>
    </div>
  )
}
