import { useState } from 'react'
import { Button } from '#/components/ui'
import { ChatGPTSignInDialog } from './ChatGPTSignInDialog'

type Props = {
  /**
   * The VM confirmed the ChatGPT account after a sign-in in the dialog; the dialog closes once
   * what it returns settles.
   */
  onConfirmed: () => void | Promise<void>
  /** The sign-in may have changed; the card reads its status again. */
  onChanged: () => void
}

/** "Sign in to ChatGPT…" on the Codex card, and the dialog it opens. */
export function ChatGPTSignIn({ onConfirmed, onChanged }: Props) {
  // Which opening of the dialog is shown, so a late confirmation closes only its own.
  const [opening, setOpening] = useState<number | null>(null)
  const [openings, setOpenings] = useState(0)
  // A confirmation still settling holds the dialog's account controls, so no newer change starts.
  const [settling, setSettling] = useState<number | null>(null)

  function open() {
    setOpenings(openings + 1)
    setOpening(openings + 1)
  }

  function confirmed(of: number) {
    setSettling(of)
    void Promise.resolve(onConfirmed()).finally(() => {
      setSettling((held) => (held === of ? null : held))
      setOpening((shown) => (shown === of ? null : shown))
    })
  }

  return (
    <>
      <Button onClick={open}>Sign in to ChatGPT…</Button>
      {opening !== null && (
        <ChatGPTSignInDialog
          key={opening}
          settling={settling === opening}
          onChanged={onChanged}
          onConfirmed={() => confirmed(opening)}
          onClose={() => setOpening(null)}
        />
      )}
    </>
  )
}
