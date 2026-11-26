import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type CredentialStatus = { configured: boolean; revision: string }

type CredentialAction = 'status' | 'save' | 'remove'

/** The pause after the last key edit before the dialog reads the protected status with it. */
export const KEY_PAUSE_MS = 600

/**
 * How long a management request may take: the guest's management server gives a request 10 s,
 * so an answer later than this won't come.
 */
const MANAGEMENT_TIMEOUT_MS = 15_000

/** The token shape the VM accepts, checked here first so nothing malformed is sent. */
const SETUP_TOKEN = /^sk-ant-oat01-[A-Za-z0-9_-]{10,2048}$/

/** Why a typed token can't be a Claude subscription token, or undefined when its shape fits. */
export function tokenShapeProblem(token: string) {
  if (!token) {
    return 'Paste the subscription token first.'
  }
  if (token.startsWith('sk-ant-api')) {
    return 'That looks like an API key, not a subscription token'
  }
  if (!SETUP_TOKEN.test(token)) {
    return 'That isn’t a subscription token. Run claude setup-token and paste the token it prints, starting sk-ant-oat01-.'
  }
  return undefined
}

/** A management request the VM answered with a refusal, or that never got an answer. */
class CredentialRequestError extends Error {
  constructor(readonly status: number | 'insecure' | 'unreachable' | 'invalid') {
    super(`credential_request_${status}`)
  }
}

function reasonFor(error: unknown) {
  const status = error instanceof CredentialRequestError ? error.status : 'unreachable'
  if (status === 403) {
    return 'The management key was refused. The saved token is unchanged.'
  }
  if (status === 'insecure') {
    return 'Signing in needs a secure connection. Nothing was sent.'
  }
  if (status === 400) {
    return 'The agent VM refused the token. The saved token is unchanged.'
  }
  return 'Couldn’t reach the Claude token service in the agent VM. Check that it is running, then try again.'
}

/** A refusal the VM answered with, which changed nothing; anything else may have applied. */
function refused(error: unknown) {
  return (
    error instanceof CredentialRequestError &&
    (error.status === 400 ||
      error.status === 403 ||
      error.status === 409 ||
      error.status === 'insecure')
  )
}

const UNCONFIRMED =
  'The agent VM didn’t confirm the change, so it may or may not have applied. Its status was read again.'

/** A token change the VM made whose model list the server couldn't mark as out of date. */
export function listNotMarked(action: 'save' | 'remove') {
  const done = action === 'save' ? 'Token saved.' : 'Token removed.'
  return `${done} Claude’s model list may be out of date for up to a minute.`
}

const TOKEN_CHANGED =
  'The token changed since this dialog read it, so nothing was saved. Its status was read again.'

type Options = {
  /**
   * The VM confirmed a change: true when a token is now saved; undefined when it may have. `late`
   * marks an answer to a dialog already closed or rekeyed, which a newer confirmation outranks.
   */
  onChanged: (configured: boolean | undefined, late?: boolean) => void | Promise<boolean | void>
  /** Closes the dialog, which drops the key. */
  onClose: () => void
}

/**
 * The Claude subscription token dialog's state. Each key typed starts a generation: after a pause
 * it reads the protected status, which enables Save and Remove. Editing the key or closing the
 * dialog ends the generation, dropping the key it held and ignoring any late answer.
 */
export function usePersonalClaudeCredential({ onChanged, onClose }: Options) {
  // Held only while the dialog is open, for the requests this generation sends.
  const key = useRef('')
  const token = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const pause = useRef<ReturnType<typeof setTimeout>>(undefined)
  // A save or remove that was sent, whose answer a closing dialog won't wait for.
  const changing = useRef(false)
  const notify = useRef(onChanged)
  useLayoutEffect(() => {
    notify.current = onChanged
  })
  const [status, setStatus] = useState<CredentialStatus>()
  const [phase, setPhase] = useState<'idle' | 'checking' | 'saving' | 'removing'>('idle')
  // A command's outcome, and apart from it why the status couldn't be read after it.
  const [message, setMessage] = useState('')
  // The change is done, but its model list may be out of date for a minute; not a failure.
  const [notice, setNotice] = useState('')
  const [readError, setReadError] = useState('')

  // Closing unmounts the dialog: its generation ends and the key goes. A change still unanswered
  // is the VM's to report, so the card reads it again.
  useEffect(() => {
    const held = key
    const generations = generation
    const waiting = pause
    const sent = changing
    return () => {
      generations.current += 1
      clearTimeout(waiting.current)
      held.current = ''
      if (sent.current) {
        sent.current = false
        void notify.current(undefined)
      }
    }
  }, [])

  async function request(action: CredentialAction, revision?: string, value?: string) {
    if (!window.isSecureContext) {
      throw new CredentialRequestError('insecure')
    }
    let response: Response
    // A timer rather than `AbortSignal.timeout`, so the bound follows the page's clock in tests too.
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), MANAGEMENT_TIMEOUT_MS)
    try {
      response = await fetch('/personal-runner/claude', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + key.current,
        },
        body: JSON.stringify({ action, revision, token: value }),
        signal: deadline.signal,
      })
    } catch {
      clearTimeout(timer)
      throw new CredentialRequestError('unreachable')
    }
    if (!response.ok) {
      clearTimeout(timer)
      throw new CredentialRequestError(response.status)
    }
    const next = await response
      .json()
      .catch(() => undefined)
      .finally(() => clearTimeout(timer))
    if (typeof next?.configured !== 'boolean' || typeof next.revision !== 'string') {
      throw new CredentialRequestError('invalid')
    }
    return { configured: next.configured, revision: next.revision } as CredentialStatus
  }

  /** The fresh protected read that enables Save and Remove for this generation. */
  async function readStatus(mine: number) {
    setPhase('checking')
    try {
      const next = await request('status')
      if (mine === generation.current) {
        setStatus(next)
        setReadError('')
      }
    } catch (error) {
      if (mine === generation.current) {
        setReadError(reasonFor(error))
      }
    } finally {
      if (mine === generation.current) {
        setPhase('idle')
      }
    }
  }

  /** A new key ends the generation; the status is read with it after a pause. */
  function editKey(value: string) {
    generation.current += 1
    const mine = generation.current
    key.current = value
    clearTimeout(pause.current)
    setStatus(undefined)
    setMessage('')
    setNotice('')
    setReadError('')
    setPhase('idle')
    if (changing.current) {
      changing.current = false
      void onChanged(undefined)
    }
    if (value) {
      pause.current = setTimeout(() => void readStatus(mine), KEY_PAUSE_MS)
    }
  }

  async function change(action: 'save' | 'remove') {
    const value = action === 'save' ? (token.current?.value ?? '') : undefined
    const shape = value === undefined ? undefined : tokenShapeProblem(value)
    if (shape) {
      setMessage(shape)
      return
    }
    if (!status || phase !== 'idle') {
      return
    }
    const mine = generation.current
    setPhase(action === 'save' ? 'saving' : 'removing')
    setMessage('')
    setNotice('')
    changing.current = true
    try {
      const next = await request(action, status.revision, value)
      if (mine !== generation.current) {
        // Closed or rekeyed meanwhile: the change is done now, so the card reads the VM again.
        void notify.current(undefined, true)
        return
      }
      changing.current = false
      // The VM stored it: the token sent is cleared so it can't be sent twice, keeping any newer edit.
      if (token.current && token.current.value === value) {
        token.current.value = ''
      }
      // Confirmed once the change's effects are recorded, such as the model list marked stale.
      const marked = await onChanged(next.configured)
      // A dialog closed or rekeyed meanwhile has moved on; this confirmation doesn't close it.
      if (mine !== generation.current) {
        return
      }
      if (marked === false) {
        // The change is done, but the server couldn't mark the model list; the dialog says so.
        setStatus(next)
        setPhase('idle')
        setNotice(listNotMarked(action))
        return
      }
      onClose()
    } catch (error) {
      if (mine !== generation.current) {
        void notify.current(undefined, true)
        return
      }
      changing.current = false
      // Whatever happened, the stored token is read again before another change can be sent.
      setStatus(undefined)
      if (!refused(error)) {
        // It may have applied, so the card reads the VM again too.
        void onChanged(undefined)
        setMessage(UNCONFIRMED)
      } else if (error instanceof CredentialRequestError && error.status === 409) {
        setMessage(TOKEN_CHANGED)
      } else {
        setMessage(reasonFor(error))
      }
      await readStatus(mine)
    }
  }

  return {
    token,
    status,
    phase,
    message,
    notice,
    readError,
    editKey,
    save: () => void change('save'),
    remove: () => void change('remove'),
  }
}
