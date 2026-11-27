import styled from 'styled-components'
import { Button, Dialog } from '#/components/ui'
import { TextField } from '#/forms'
import { color, space } from '#/theme/generated/tokens'
import { usePersonalClaudeCredential } from './usePersonalClaudeCredential'

type Props = {
  /** The VM confirmed a change, or one may have happened; the card reads its status again. */
  onChanged: (configured: boolean | undefined, late?: boolean) => void | Promise<boolean | void>
  onClose: () => void
}

/** The Claude subscription token dialog: the management key, the token, Save and Remove. */
export function ClaudeTokenDialog({ onChanged, onClose }: Props) {
  const { token, status, phase, message, notice, readError, editKey, save, remove } =
    usePersonalClaudeCredential({
      onChanged,
      onClose,
    })
  const ready = status !== undefined && phase === 'idle'

  let state = 'Enter the management key to read the token’s status.'
  if (phase === 'checking') {
    state = 'Checking…'
  } else if (status) {
    state = status.configured ? 'A token is saved.' : 'No token is saved.'
  }

  return (
    <Dialog title="Claude subscription token" onClose={onClose}>
      <Form
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <TextField
          label="Personal runner management key"
          type="password"
          autoComplete="off"
          help="Held only while this dialog is open."
          onChange={(event) => editKey(event.target.value)}
        />
        <p role="status">{state}</p>
        <TextField
          ref={token}
          label="Subscription token"
          type="password"
          autoComplete="off"
          help="From claude setup-token; it starts sk-ant-oat01-."
        />
        {message && <Alert role="alert">{message}</Alert>}
        {notice && <p role="status">{notice}</p>}
        {readError && <Alert role="alert">{readError}</Alert>}
        <Actions>
          <Button type="submit" variant="primary" disabled={!ready}>
            {phase === 'saving' ? 'Saving…' : status?.configured ? 'Replace token' : 'Save token'}
          </Button>
          {status?.configured && (
            <Button disabled={!ready} onClick={remove}>
              {phase === 'removing' ? 'Removing…' : 'Remove token'}
            </Button>
          )}
        </Actions>
      </Form>
    </Dialog>
  )
}

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${space[5]};
  p {
    margin: 0;
  }
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[3]};
`

const Alert = styled.p`
  color: ${color.bad};
`
