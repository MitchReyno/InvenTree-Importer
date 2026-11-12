import { Button } from '#/components/ui'
import { TextField } from '#/forms'
import type { ChatGPTSignInState } from './useChatGPTSignIn'

type Props = {
  /** The panel's state, held by the Agents settings section so its provider card agrees. */
  signIn: ChatGPTSignInState
}

export function ChatGPTSignIn({ signIn }: Props) {
  const { key, open, busy, blocked, shown, shownMessage, request, toggle, editKey } = signIn

  return (
    <section>
      <Button aria-expanded={open} disabled={busy} onClick={toggle}>
        ChatGPT subscription
      </Button>
      {open && (
        <fieldset>
          <legend>Codex in the shared VM</legend>
          <p>
            Enable device code sign-in for Codex in{' '}
            <a href="https://chatgpt.com/#settings/Security" target="_blank" rel="noreferrer">
              ChatGPT Security Settings
            </a>{' '}
            before starting. If you just enabled it, cancel the previous code and start again.
          </p>
          <TextField
            label="Codex runner management key"
            ref={key}
            type="password"
            autoComplete="off"
            // A command waiting behind an earlier poll is sent with the key it was clicked with.
            readOnly={busy}
            help={
              busy ? 'Waiting for the runner. The key can be changed once it answers.' : undefined
            }
            onChange={editKey}
          />
          <Button disabled={blocked} onClick={() => void request('status')}>
            Check ChatGPT connection
          </Button>
          {shown?.state === 'connected' ? (
            <>
              <p role="status">Connected to ChatGPT</p>
              <Button disabled={blocked} onClick={() => void request('disconnect')}>
                Disconnect ChatGPT
              </Button>
            </>
          ) : shown?.state === 'pending' ? (
            <>
              <p>
                Open{' '}
                <a href={shown.verificationUrl} target="_blank" rel="noreferrer">
                  OpenAI device verification
                </a>{' '}
                and enter <strong>{shown.userCode}</strong>.
              </p>
              <Button disabled={blocked} onClick={() => void request('cancel', shown.loginId)}>
                Cancel sign-in
              </Button>
            </>
          ) : (
            <>
              <Button disabled={blocked} onClick={() => void request('start')}>
                Sign in with ChatGPT
              </Button>
              {shown?.state === 'denied' && <p>Sign-in was declined or expired.</p>}
            </>
          )}
          {shownMessage && <p role="alert">{shownMessage}</p>}
        </fieldset>
      )}
    </section>
  )
}
