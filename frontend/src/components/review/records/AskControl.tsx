import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { space } from '../../../theme/generated/tokens'
import { Button } from '../../ui/Button'
import { Small, TextArea } from '../../ui/primitives'

/**
 * Asks the step that proposed a field, through its session's inbox. "Asked" stays until the
 * field's value changes; the reply itself is in the session drawer in Processing.
 */
export function AskControl({
  step,
  value,
  prefill,
  send,
}: {
  step: string
  value: string | null
  prefill: string
  send: (text: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(prefill)
  const [busy, setBusy] = useState(false)
  const [asked, setAsked] = useState(false)
  const [failed, setFailed] = useState(false)
  const askedValue = useRef(value)
  useEffect(() => {
    if (asked && value !== askedValue.current) {
      setAsked(false)
    }
  }, [asked, value])

  if (asked) {
    return <Small role="status">Asked {step}</Small>
  }
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Ask {step}
      </Button>
    )
  }
  return (
    <Form
      onSubmit={(event) => {
        event.preventDefault()
        setBusy(true)
        setFailed(false)
        send(text.trim())
          .then(() => {
            askedValue.current = value
            setAsked(true)
            setOpen(false)
          })
          .catch(() => setFailed(true))
          .finally(() => setBusy(false))
      }}
    >
      <TextArea
        aria-label={`Message to ${step}`}
        value={text}
        rows={2}
        maxLength={4096}
        disabled={busy}
        onChange={(event) => setText(event.target.value)}
      />
      <Row>
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          Send to {step}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {failed && <Small role="alert">Not sent. The message is kept to try again.</Small>}
      </Row>
    </Form>
  )
}

const Form = styled.form`
  display: grid;
  gap: ${space[1]};
`
const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[1]};
`
