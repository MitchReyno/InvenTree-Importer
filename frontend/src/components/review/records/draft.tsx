import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import type { CaptureEditDto, CaptureSnapshotDto, RecordChangeDto } from '@invimport/contracts'
import { refusal } from '../../../records/model'
import { color, space, typeVar } from '../../../theme/generated/tokens'
import { Button } from '../../ui/Button'

export type Save = (change: CaptureEditDto['change']) => Promise<boolean>

/**
 * A local draft that reports itself dirty until it matches the saved value again. While clean it
 * follows the saved value, so a save elsewhere neither discards it nor leaves it stale.
 */
export function useDraft<T>(saved: T, report: (dirty: boolean) => void) {
  const [value, setValue] = useState(saved)
  const savedText = JSON.stringify(saved)
  const previous = useRef({ text: savedText })
  const dirty = JSON.stringify(value) !== savedText
  useEffect(() => {
    const old = previous.current.text
    if (old !== savedText) {
      // Only a draft still matching the old saved value moves with it. The updater may run on a
      // later render, so it compares with the captured old text, not the ref.
      setValue((current) => (JSON.stringify(current) === old ? saved : current))
      previous.current = { text: savedText }
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
export const ReloadContext = createContext<(() => Promise<boolean>) | undefined>(undefined)

/** One record save at a time: the batch sends one edit, so every Save waits for it. */
export const SavingContext = createContext<{
  saving: boolean
  setSaving: (value: boolean) => void
}>({
  saving: false,
  setSaving: () => {},
})

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
  const { setSaving } = useContext(SavingContext)

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
    setSaving(true)
    try {
      const saved = await save(change)
      setUnsaved(!saved)
      if (saved) {
        onSaved?.()
      }
      return saved
    } finally {
      setBusy(false)
      setSaving(false)
    }
  }

  const retry =
    unsaved && reload
      ? async () => {
          if (await reload()) {
            setUnsaved(false)
          }
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
  const { saving } = useContext(SavingContext)
  return (
    <Row>
      <Button size="sm" disabled={disabled || busy || saving} busy={busy} onClick={onSave}>
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
  gap: ${space[4]};
`

const Problem = styled.span`
  color: ${color.bad};
  font-size: ${typeVar.small.size};
`
