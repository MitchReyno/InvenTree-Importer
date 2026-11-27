import { useState } from 'react'
import { Button } from '#/components/ui'
import { ClaudeTokenDialog } from './ClaudeTokenDialog'

type Props = {
  /** The VM confirmed a change, or one may have happened; the card reads its status again. */
  onChanged: (configured: boolean | undefined, late?: boolean) => void | Promise<boolean | void>
}

/** "Subscription token…" on the Claude card, and the dialog it opens. */
export function PersonalClaudeCredential({ onChanged }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)}>Subscription token…</Button>
      {open && <ClaudeTokenDialog onChanged={onChanged} onClose={() => setOpen(false)} />}
    </>
  )
}
