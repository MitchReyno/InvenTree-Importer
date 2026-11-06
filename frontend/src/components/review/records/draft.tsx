import { useEffect, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import type { CaptureEditDto, CaptureSnapshotDto, RecordChangeDto } from '@invimport/contracts'
import { refusal } from '../../../records/model'
import { color, space } from '../../../theme/generated/tokens'
import { Button } from '../../ui/Button'

export type Save = (change: CaptureEditDto['change']) => Promise<boolean>

/** A local draft that reports itself dirty until it matches the saved value again. */
export function useDraft<T>(saved: T, report: (dirty: boolean) => void) {
  const [value, setValue] = useState(saved)
  const dirty = JSON.stringify(value) !== JSON.stringify(saved)
  useEffect(() => {
    report(dirty)
  }, [dirty, report])
  useEffect(() => () => report(false), [report])
  return [value, setValue, dirty] as const
}

/**
 * Checks a record edit against the loaded batch, then sends it. A refused or failed save keeps the
 * draft; the batch shows why, and the operator retries explicitly.
 */
export function useRecordSave(batch: CaptureSnapshotDto, save: Save) {
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)

  async function send(change: RecordChangeDto | CaptureEditDto['change']) {
    if (change.kind === 'record') {
      const refused = refusal(batch, change)
      if (refused) {
        setProblem(refused)
        return false
      }
    }
    setProblem('')
    setBusy(true)
    try {
      return await save(change)
    } finally {
      setBusy(false)
    }
  }

  return { send, problem, busy }
}

export function SaveRow({
  label = 'Save',
  disabled,
  busy,
  problem,
  onSave,
  children,
}: {
  label?: string
  disabled: boolean
  busy: boolean
  problem: string
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
