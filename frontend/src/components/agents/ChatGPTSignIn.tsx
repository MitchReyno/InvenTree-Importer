import { useRef, useState } from 'react'
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
  // Account changes reported from the dialog; a newer one keeps it open over an older confirmation.
  const changes = useRef(0)

  function open() {
    setOpenings(openings + 1)
    setOpening(openings + 1)
  }

  function changed() {
    changes.current += 1
    onChanged()
  }

  function confirmed(of: number) {
    changes.current += 1
    const mine = changes.current
    void Promise.resolve(onConfirmed()).finally(() => {
      if (changes.current === mine) {
        setOpening((shown) => (shown === of ? null : shown))
      }
    })
  }

  return (
    <>
      <Button onClick={open}>Sign in to ChatGPT…</Button>
      {opening !== null && (
        <ChatGPTSignInDialog
          key={opening}
          onChanged={changed}
          onConfirmed={() => confirmed(opening)}
          onClose={() => setOpening(null)}
        />
      )}
    </>
  )
}
