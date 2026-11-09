import { useRef, useState } from 'react'
import type { ProviderStatus } from './provider-status'

type CredentialStatus = { configured: boolean; revision: string }

/**
 * The personal Claude credential panel's state and requests. The Agents settings section holds it,
 * so the provider card shows the same status as the panel without an Effect.
 */
export function usePersonalClaudeCredential() {
  const key = useRef<HTMLInputElement>(null)
  const token = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<CredentialStatus>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  async function submit(action: 'status' | 'save' | 'remove') {
    setBusy(true)
    setMessage('')
    try {
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
    } catch {
      setStatus(undefined)
      setMessage(
        'Request unconfirmed. Check your management key and reconnect to the personal runner.',
      )
    } finally {
      setBusy(false)
    }
  }

  function toggle() {
    setOpen(!open)
    setStatus(undefined)
    setMessage('')
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
