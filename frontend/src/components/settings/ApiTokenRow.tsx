import { useState, type FormEvent } from 'react'
import styled from 'styled-components'
import { IntakeRequestError } from '@invimport/contracts/client'
import {
  InventoryCredentialReplace,
  MAX_INVENTORY_TOKEN_LENGTH,
  type ConnectionStatusDto,
} from '@invimport/contracts'
import { Banner, Button, SettingRow, Small, type BannerTone } from '#/components/ui'
import { TextField } from '#/forms'
import { CheckConnectionButton } from '#/components/masthead/CheckConnectionButton'
import type { useHeaderObservations } from '#/header/useHeaderObservations'
import { useReportDirty } from '#/navigation/useReportDirty'
import { color, space, typeVar } from '#/theme/generated/tokens'

type Observations = ReturnType<typeof useHeaderObservations>
type Target = ConnectionStatusDto['target']

const SHORT_TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }
const SAVED_AT: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }

const TOKEN_PATTERN = new RegExp(InventoryCredentialReplace.properties.token.pattern!)

const TOKEN_STATUS = { accepted: 'Accepted', refused: 'Refused', unavailable: 'Unavailable' }

/** What the last token command came to, in the operator's terms. */
const OUTCOME = {
  saved: { tone: 'ok', text: 'Saved. Reads now use this token.' },
  reverted: { tone: 'ok', text: 'Deleted. Reads use the environment token again.' },
  token_refused: {
    tone: 'bad',
    text: 'InvenTree refused this token. Nothing was saved, and the current token stays in use.',
  },
  target_unavailable: {
    tone: 'bad',
    text: 'InvenTree couldn’t be reached to check this token. Nothing was saved, and the current token stays in use.',
  },
  secret_store_unavailable: {
    tone: 'bad',
    text: 'The server has nowhere to save a token. Set INTAKE_SECRETS_DIR in the server’s environment, then try again.',
  },
  credential_change_in_progress: {
    tone: 'warn',
    text: 'Another token change is still running. Nothing was changed; try again in a moment.',
  },
  unconfirmed: {
    tone: 'warn',
    text: 'The server didn’t confirm the change. The line above shows which token is in use once the next read arrives.',
  },
} satisfies Record<string, { tone: BannerTone; text: string }>

type Outcome = keyof typeof OUTCOME

/** The server's refusal codes this row explains; anything else is unconfirmed. */
function commandOutcome(error: unknown): Outcome {
  const code = error instanceof IntakeRequestError ? error.code : undefined
  if (
    code === 'token_refused' ||
    code === 'target_unavailable' ||
    code === 'secret_store_unavailable' ||
    code === 'credential_change_in_progress'
  ) {
    return code
  }
  return 'unconfirmed'
}

/**
 * A fresh reachable read proves the token works and a fresh 401 or 403 is a refusal. A stale
 * observation or a failed read says nothing current, so it is Unavailable.
 */
function tokenStatus(target: Target | undefined, current: boolean) {
  if (!current) {
    return 'unavailable'
  }
  if (target?.state === 'reachable') {
    return 'accepted'
  }
  return target?.failure_code === 'unauthorized' ? 'refused' : 'unavailable'
}

function tokenProblem(token: string) {
  if (token === '') {
    return 'Paste a token first.'
  }
  if (!TOKEN_PATTERN.test(token) || token.length > MAX_INVENTORY_TOKEN_LENGTH) {
    return 'A token has no spaces and is at most 4,096 characters.'
  }
  return undefined
}

/** Which token reads use, from the observation; never the token. */
function tokenSource(target: Target | undefined) {
  if (target?.credential_source === 'saved' && target.credential_saved_at) {
    const savedAt = new Date(target.credential_saved_at).toLocaleString([], SAVED_AT)
    return `Using the token saved here on ${savedAt}.`
  }
  if (target?.credential_source === 'environment') {
    return 'Using the token from the server’s environment.'
  }
  return null
}

/** A stable callback ref, so the element is focused once, when it appears. */
function focusOnMount(node: HTMLElement | null) {
  node?.focus()
}

type Props = {
  target: Target | undefined
  /** Whether the observation is fresh enough to say anything about the token. */
  current: boolean
  observations: Observations | null
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * Settings › InvenTree › API token: its status, which token is in use, and a write-only field
 * to replace it. The field is never filled from the server, and the token is held only here.
 */
export function ApiTokenRow({ target, current, observations, onDirtyChange }: Props) {
  const [mode, setMode] = useState<'idle' | 'replacing' | 'confirmingRevert'>('idle')
  const [token, setToken] = useState('')
  const [problem, setProblem] = useState<string>()
  const [outcome, setOutcome] = useState<Outcome>()
  const [pending, setPending] = useState<'replace' | 'revert'>()
  // The trigger that gets focus back when the inline form or confirmation closes.
  const [returnFocus, setReturnFocus] = useState<'replace' | 'revert'>()
  useReportDirty(token !== '', onDirtyChange)
  const source = tokenSource(target)
  const saved = target?.credential_source === 'saved'

  function editToken(value: string) {
    setToken(value)
    setProblem(undefined)
    onDirtyChange?.(value !== '')
  }

  function open(next: 'replacing' | 'confirmingRevert') {
    setOutcome(undefined)
    setMode(next)
  }

  function close(focus: 'replace' | 'revert') {
    setReturnFocus(focus)
    setMode('idle')
  }

  async function checkAndSave(event: FormEvent) {
    event.preventDefault()
    if (!observations || pending) {
      return
    }
    const found = tokenProblem(token)
    if (found) {
      setProblem(found)
      return
    }
    setOutcome(undefined)
    setPending('replace')
    try {
      await observations.replaceToken(token)
      editToken('')
      close('replace')
      setOutcome('saved')
    } catch (error) {
      setOutcome(commandOutcome(error))
    } finally {
      setPending(undefined)
    }
  }

  async function revertToEnvironment() {
    if (!observations || pending) {
      return
    }
    setOutcome(undefined)
    setPending('revert')
    try {
      await observations.revertToken()
      setOutcome('reverted')
      // The revert trigger goes once the environment token is in use.
      close('replace')
    } catch (error) {
      setOutcome(commandOutcome(error))
      close('revert')
    } finally {
      setPending(undefined)
    }
  }

  return (
    <SettingRow label="API token" help="Kept on the server and never shown.">
      <Stack>
        <Status>
          {TOKEN_STATUS[tokenStatus(target, current)]}
          {target?.observed_at && (
            <Small>
              · checked {new Date(target.observed_at).toLocaleTimeString([], SHORT_TIME)}
            </Small>
          )}
        </Status>
        {source && <Small>{source}</Small>}
        {mode === 'idle' && observations && (
          <Actions>
            <CheckConnectionButton check={observations.check} label="Check now" />
            <Button
              ref={returnFocus === 'replace' ? focusOnMount : undefined}
              variant="ghost"
              size="sm"
              onClick={() => open('replacing')}
            >
              Replace token…
            </Button>
            {saved && (
              <Button
                ref={returnFocus === 'revert' ? focusOnMount : undefined}
                variant="ghost"
                size="sm"
                onClick={() => open('confirmingRevert')}
              >
                Use the environment token…
              </Button>
            )}
          </Actions>
        )}
        {mode === 'replacing' && (
          <Form aria-label="Replace token" onSubmit={(event) => void checkAndSave(event)}>
            <TextField
              ref={focusOnMount}
              label="New API token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              readOnly={pending === 'replace'}
              error={problem}
              help="A read-only token from InvenTree. It’s checked with InvenTree before it’s saved, and never shown again."
              onChange={(event) => editToken(event.target.value)}
            />
            <Actions>
              <Button type="submit" size="sm" aria-disabled={pending ? true : undefined}>
                {pending === 'replace' ? 'Checking…' : 'Check and save'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-disabled={pending ? true : undefined}
                onClick={() => {
                  if (!pending) {
                    editToken('')
                    close('replace')
                  }
                }}
              >
                Cancel
              </Button>
            </Actions>
          </Form>
        )}
        {mode === 'confirmingRevert' && (
          <Confirm role="group" aria-label="Use the environment token">
            <Small>
              Delete the saved token? Reads go back to the token in the server’s environment.
            </Small>
            <Actions>
              <Button
                variant="warn"
                size="sm"
                aria-disabled={pending ? true : undefined}
                onClick={() => void revertToEnvironment()}
              >
                {pending === 'revert' ? 'Deleting…' : 'Delete and use the environment token'}
              </Button>
              <Button
                ref={focusOnMount}
                variant="ghost"
                size="sm"
                aria-disabled={pending ? true : undefined}
                onClick={() => {
                  if (!pending) {
                    close('revert')
                  }
                }}
              >
                Keep the saved token
              </Button>
            </Actions>
          </Confirm>
        )}
        {outcome && (
          <div role="status">
            <Banner tone={OUTCOME[outcome].tone}>{OUTCOME[outcome].text}</Banner>
          </div>
        )}
      </Stack>
    </SettingRow>
  )
}

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[4]};
  small {
    color: ${color.muted};
  }
`

const Status = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${space[3]};
  font-weight: ${typeVar.bodyStrong.weight};
`

const Actions = styled.span`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: ${space[4]};
`

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${space[4]};
  width: min(100%, 28rem);
`

const Confirm = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
`
