import { useState } from 'react'
import { Button } from '#/components/ui'
import { ChatGPTSignInDialog } from './ChatGPTSignInDialog'

type Props = {
  /** The VM confirmed the ChatGPT account after a sign-in in the dialog. */
  onConfirmed: () => void
  /** The sign-in may have changed; the card reads its status again. */
  onChanged: () => void
}

/** "Sign in to ChatGPT…" on the Codex card, and the dialog it opens. */
export function ChatGPTSignIn({ onConfirmed, onChanged }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)}>Sign in to ChatGPT…</Button>
      {open && (
        <ChatGPTSignInDialog
          onChanged={onChanged}
          onConfirmed={() => {
            setOpen(false)
            onConfirmed()
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
