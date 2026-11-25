import styled from 'styled-components'
import { Button, Dialog } from '#/components/ui'
import { TextField } from '#/forms'
import { color, space } from '#/theme/generated/tokens'
import { useChatGPTSignIn } from './useChatGPTSignIn'

type Props = {
  /** The VM confirmed the ChatGPT account after a sign-in in the dialog. */
  onConfirmed: () => void
  /** The sign-in may have changed; the card reads its status again. */
  onChanged: () => void
  onClose: () => void
  /** The confirmed account is being recorded; nothing can change it until that settles. */
  settling?: boolean
}

/** The ChatGPT sign-in dialog: the management key, then the device sign-in. */
export function ChatGPTSignInDialog({ onConfirmed, onChanged, onClose, settling = false }: Props) {
  const signIn = useChatGPTSignIn({ onConfirmed, onChanged })
  const { busy, shown, shownMessage, request, editKey } = signIn
  const blocked = signIn.blocked || settling

  function account() {
    if (shown?.state === 'connected') {
      return (
        <>
          <p role="status">
            {settling ? 'Signed in to ChatGPT. Updating the model list…' : 'Signed in to ChatGPT'}
          </p>
          <Button disabled={blocked} onClick={() => void request('disconnect')}>
            Disconnect ChatGPT
          </Button>
        </>
      )
    }
    if (shown?.state === 'pending') {
      return (
        <>
          <p>
            Open{' '}
            <a href={shown.verificationUrl} target="_blank" rel="noreferrer">
              OpenAI device verification
            </a>{' '}
            and enter <strong>{shown.userCode}</strong>. This dialog closes once the agent VM
            confirms the account.
          </p>
          <Button disabled={blocked} onClick={() => void request('cancel', shown.loginId)}>
            Cancel sign-in
          </Button>
        </>
      )
    }
    if (shown) {
      return (
        <>
          <p role="status">
            {shown.state === 'denied' ? 'Sign-in was declined or expired.' : 'Not signed in.'}
          </p>
          <Button variant="primary" disabled={blocked} onClick={() => void request('start')}>
            Sign in with ChatGPT
          </Button>
        </>
      )
    }
    return (
      <p role="status">
        {busy ? 'Checking…' : 'Enter the management key to read the sign-in status.'}
      </p>
    )
  }

  return (
    <Dialog title="Sign in to ChatGPT" onClose={onClose}>
      <Body>
        <p>
          Enable device code sign-in for Codex in{' '}
          <a href="https://chatgpt.com/#settings/Security" target="_blank" rel="noreferrer">
            ChatGPT Security Settings
          </a>{' '}
          before starting. If you just enabled it, cancel the previous code and start again.
        </p>
        <TextField
          label="Codex runner management key"
          type="password"
          autoComplete="off"
          help="Held only while this dialog is open."
          disabled={settling}
          onChange={(event) => editKey(event.target.value)}
        />
        {account()}
        {shownMessage && <Alert role="alert">{shownMessage}</Alert>}
      </Body>
    </Dialog>
  )
}

const Body = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[5]};
  p {
    margin: 0;
  }
`

const Alert = styled.p`
  color: ${color.bad};
`
