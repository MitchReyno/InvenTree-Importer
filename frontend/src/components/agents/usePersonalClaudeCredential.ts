import { useRef, useState } from 'react'
import { useAsyncAction } from '#/lifecycle/useAsyncAction'
import type { ProviderStatus } from './provider-status'

type CredentialStatus = { configured: boolean; revision: string }

type CredentialAction = 'status' | 'save' | 'remove'

const UNCONFIRMED =
  'Request unconfirmed. Check your management key and reconnect to the personal runner.'

/**
 * The personal Claude credential panel's state and requests. The Agents settings section holds it,
 * so the provider card shows the same status as the panel without an Effect.
 */
export function usePersonalClaudeCredential() {
  const key = useRef<HTMLInputElement>(null)
  const token = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<CredentialStatus>()
  const [open, setOpen] = useState(false)
  const { busy, error: message, run, clearError } = useAsyncAction()

  async function request(action: CredentialAction) {
    if (!window.isSecureContext) {
      throw new Error()
    }

    const response = await fetch('/personal-runner/claude', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + key.current?.value,
      },
      body: JSON.stringify({
        action,
        revision: status?.revision,
        token: action === 'save' ? token.current?.value : undefined,
      }),
    })
    if (!response.ok) {
      throw new Error()
    }

    const next = await response.json()
    if (typeof next.configured !== 'boolean' || typeof next.revision !== 'string') {
      throw new Error()
    }

    setStatus({ configured: next.configured, revision: next.revision })
    if (token.current) {
      token.current.value = ''
    }
  }

  async function submit(action: CredentialAction) {
    const outcome = await run(() => request(action), UNCONFIRMED)
    if (outcome === 'failed') {
      setStatus(undefined)
    }
  }

  function toggle() {
    setOpen(!open)
    setStatus(undefined)
    clearError()
  }

  /** A new key clears the result but leaves an error shown. */
  function editKey() {
    setStatus(undefined)
  }

  let card: ProviderStatus = 'Not checked'
  if (message) {
    card = 'Check failed'
  } else if (status) {
    card = status.configured ? 'Configured' : 'Unconfigured'
  }

  return { key, token, status, message, busy, open, submit, toggle, editKey, card }
}

export type PersonalClaudeCredentialState = ReturnType<typeof usePersonalClaudeCredential>
