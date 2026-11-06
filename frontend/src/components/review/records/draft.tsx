import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import type { CaptureEditDto, CaptureSnapshotDto, RecordChangeDto } from '@invimport/contracts'
import { refusal } from '../../../records/model'
import { color, space } from '../../../theme/generated/tokens'
import { Button } from '../../ui/Button'

export type Save = (change: CaptureEditDto['change']) => Promise<boolean>

/**
 * A local draft that reports itself dirty until it matches the saved value again. While clean it
 * follows the saved value, so a save elsewhere neither discards it nor leaves it stale.
 */
export function useDraft<T>(saved: T, report: (dirty: boolean) => void) {
  const [value, setValue] = useState(saved)
  const savedText = JSON.stringify(saved)
  const previous = useRef({ text: savedText, value: saved })
  const dirty = JSON.stringify(value) !== savedText
  useEffect(() => {
    if (previous.current.text !== savedText) {
      // Only a draft still matching the old saved value moves with it.
      setValue((current) => (JSON.stringify(current) === previous.current.text ? saved : current))
      previous.current = { text: savedText, value: saved }
    }
  }, [savedText, saved])
  useEffect(() => {
    report(dirty)
  }, [dirty, report])
  useEffect(() => () => report(false), [report])

  const reset = () => setValue(saved)

  return [value, setValue, dirty, reset] as const
}

/** Loads the current batch without touching record drafts, so a refused save can be retried. */
export const ReloadContext = createContext<(() => Promise<void>) | undefined>(undefined)

/**
 * Checks a record edit against the loaded batch, then sends it. A refused or failed save keeps the
 * draft and offers to load current values, so the operator retries explicitly. `onSaved` clears
 * a draft that does not follow the saved value, such as a choice to map.
 */
export function useRecordSave(batch: CaptureSnapshotDto, save: Save, onSaved?: () => void) {
  const [problem, setProblem] = useState('')
  const [unsaved, setUnsaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const reload = useContext(ReloadContext)

  async function send(change: RecordChangeDto | CaptureEditDto['change']) {
    if (change.kind === 'record') {
      const refused = refusal(batch, change)
      if (refused) {
        setProblem(refused)
        return false
      }
    }
    setProblem('')
    setUnsaved(false)
    setBusy(true)
    try {
      const saved = await save(change)
      setUnsaved(!saved)
      if (saved) {
        onSaved?.()
      }
      return saved
    } finally {
      setBusy(false)
    }
  }

  const retry =
    unsaved && reload
      ? async () => {
          await reload()
          setUnsaved(false)
        }
      : undefined

  return { send, problem, busy, retry }
}

export function SaveRow({
  label = 'Save',
  disabled,
  busy,
  problem,
  retry,
  onSave,
  children,
}: {
  label?: string
  disabled: boolean
  busy: boolean
  problem: string
  /** Offered after a refused save: loads current values and keeps this draft. */
  retry?: () => Promise<void>
  onSave: () => void
  children?: ReactNode
}) {
  return (
    <Row>
      <Button size="sm" disabled={disabled || busy} busy={busy} onClick={onSave}>
        {label}
      </Button>
      {children}
      {problem && <Problem role="alert">{problem}</Problem>}
      {retry && (
        <Button size="sm" variant="ghost" onClick={() => void retry()}>
          Load current values, keep this draft
        </Button>
      )}
    </Row>
  )
}

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]};
`

const Problem = styled.span`
  color: ${color.bad};
  font-size: 13px;
`
