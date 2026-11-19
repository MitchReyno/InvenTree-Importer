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
  unconfirmed: {
    tone: 'warn',
    text: 'The server didn’t confirm the change. The line above shows which token is in use after the next read.',
  },
} satisfies Record<string, { tone: BannerTone; text: string }>

type Outcome = keyof typeof OUTCOME

/** The server's refusal codes this row explains; anything else is unconfirmed. */
function commandOutcome(error: unknown): Outcome {
  const code = error instanceof IntakeRequestError ? error.code : undefined
  if (
    code === 'token_refused' ||
    code === 'target_unavailable' ||
    code === 'secret_store_unavailable'
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

function TokenSource({ target }: { target: Target | undefined }) {
  if (target?.credential_source === 'saved' && target.credential_saved_at) {
    const savedAt = new Date(target.credential_saved_at).toLocaleString([], SAVED_AT)
    return <Small>Using the token saved here on {savedAt}.</Small>
  }
  if (target?.credential_source === 'environment') {
    return <Small>Using the token from the server’s environment.</Small>
  }
  return null
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
 * to replace it. The field is never filled from the server.
 */
export function ApiTokenRow({ target, current, observations, onDirtyChange }: Props) {
  const [mode, setMode] = useState<'idle' | 'replacing' | 'confirmingRevert'>('idle')
  const [token, setToken] = useState('')
  const [problem, setProblem] = useState<string>()
  const [outcome, setOutcome] = useState<Outcome>()
  useReportDirty(token !== '', onDirtyChange)
  const busy = Boolean(observations?.replaceToken.isPending || observations?.revertToken.isPending)

  function editToken(value: string) {
    setToken(value)
    setProblem(undefined)
    onDirtyChange?.(value !== '')
  }

  function closeReplace() {
    editToken('')
    setMode('idle')
  }

  async function checkAndSave(event: FormEvent) {
    event.preventDefault()
    if (!observations || busy) {
      return
    }
    const found = tokenProblem(token)
    if (found) {
      setProblem(found)
      return
    }
    setOutcome(undefined)
    try {
      await observations.replaceToken.mutateAsync(token)
      closeReplace()
      setOutcome('saved')
    } catch (error) {
      setOutcome(commandOutcome(error))
    }
  }

  async function revertToEnvironment() {
    if (!observations || busy) {
      return
    }
    setOutcome(undefined)
    try {
      await observations.revertToken.mutateAsync()
      setOutcome('reverted')
    } catch (error) {
      setOutcome(commandOutcome(error))
    }
    setMode('idle')
  }

  const saved = target?.credential_source === 'saved'

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
        <TokenSource target={target} />
        {mode === 'idle' && (
          <Actions>
            {observations && <CheckConnectionButton check={observations.check} label="Check now" />}
            {observations && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOutcome(undefined)
                  setMode('replacing')
                }}
              >
                Replace token…
              </Button>
            )}
            {observations && saved && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOutcome(undefined)
                  setMode('confirmingRevert')
                }}
              >
                Use the environment token…
              </Button>
            )}
          </Actions>
        )}
        {mode === 'replacing' && (
          <Form aria-label="Replace token" onSubmit={(event) => void checkAndSave(event)}>
            <TextField
              label="New API token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              error={problem}
              help="A read-only token from InvenTree. It’s checked with InvenTree before it’s saved, and never shown again."
              onChange={(event) => editToken(event.target.value)}
            />
            <Actions>
              <Button type="submit" size="sm" aria-disabled={busy || undefined}>
                {observations?.replaceToken.isPending ? 'Checking…' : 'Check and save'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (!busy) {
                    closeReplace()
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
                aria-disabled={busy || undefined}
                onClick={() => void revertToEnvironment()}
              >
                {observations?.revertToken.isPending
                  ? 'Deleting…'
                  : 'Delete and use the environment token'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (!busy) {
                    setMode('idle')
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
