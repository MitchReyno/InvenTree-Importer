import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CaptureSnapshotDto,
  MediaEditDto,
  MediaSnapshotDto,
  MediaVersionDto,
} from '@invimport/contracts'
import { Button, Heading, Paragraph, Small } from '../ui/primitives'
import type { MediaClient } from '../../media/types'
import { MediaUpload } from './MediaUpload'
import { MediaEvidenceCard } from './MediaEvidenceCard'
import { MediaEvidenceRelations } from './MediaEvidenceRelations'
import { MediaCropDialog } from './MediaCropDialog'

interface Props {
  batch: CaptureSnapshotDto
  client: MediaClient
  disabled: boolean
  selectedSubject: string
  onDirtyChange: (dirty: boolean) => void
}

export function MediaWorkspace({ batch, client, disabled, selectedSubject, onDirtyChange }: Props) {
  const [snapshot, setSnapshot] = useState<MediaSnapshotDto | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploadDirty, setUploadDirty] = useState(false)
  const [, setCropDirty] = useState(false)
  const [crop, setCrop] = useState<{ version: MediaVersionDto; page: number } | null>(null)

  const dirtyFlags = useRef({ upload: false, crop: false })
  const dirtyGroups = useRef(new Set<string>())

  const reportUploadDirty = useCallback(
    (dirty: boolean) => {
      dirtyFlags.current.upload = dirty
      setUploadDirty(dirty)
      onDirtyChange(
        dirtyFlags.current.upload || dirtyFlags.current.crop || dirtyGroups.current.size > 0,
      )
    },
    [onDirtyChange],
  )

  const reportCropDirty = useCallback(
    (dirty: boolean) => {
      dirtyFlags.current.crop = dirty
      setCropDirty(dirty)
      onDirtyChange(
        dirtyFlags.current.upload || dirtyFlags.current.crop || dirtyGroups.current.size > 0,
      )
    },
    [onDirtyChange],
  )

  const reportGroupDirty = useCallback(
    (evidenceId: string, dirty: boolean) => {
      if (dirty) {
        dirtyGroups.current.add(evidenceId)
      } else {
        dirtyGroups.current.delete(evidenceId)
      }
      onDirtyChange(
        dirtyFlags.current.upload || dirtyFlags.current.crop || dirtyGroups.current.size > 0,
      )
    },
    [onDirtyChange],
  )

  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const refresh = useCallback(async () => {
    setSnapshot(await client.snapshot(batch.id))
  }, [client, batch.id])

  useEffect(() => {
    let active = true
    async function poll() {
      try {
        const current = await client.snapshot(batch.id)
        if (active) {
          setSnapshot(current)
        }
      } catch {
        if (active) {
          setError(
            'Saved media is unavailable. Retained receipts remain valid; refresh when the service returns.',
          )
        }
      }
    }
    void poll()
    const interval = setInterval(() => void poll(), 3000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [batch.id, client])

  async function edit(change: MediaEditDto['change']) {
    if (!snapshot) {
      throw new Error('media_not_loaded')
    }
    setBusy(true)
    setError('')
    try {
      setSnapshot(
        await client.edit(
          batch.id,
          {
            expected_revision: snapshot.revision,
            change,
          },
          crypto.randomUUID(),
        ),
      )
    } catch (failure) {
      setError(
        'Media change was not confirmed. Refresh saved evidence before deciding whether to submit again.',
      )
      throw failure
    } finally {
      setBusy(false)
    }
  }

  const subject = batch.lots.find((lot) => lot.id === selectedSubject)
  const selection = snapshot?.attachments.find((item) => item.subject_id === selectedSubject)
  const frozen = disabled || busy || !snapshot

  return (
    <section aria-labelledby="retained-evidence-title">
      <Heading id="retained-evidence-title">Photos and documents</Heading>
      <Paragraph>
        Evidence can support several lots or shared Parts. Grouping does not create stock.
      </Paragraph>
      {error && <Paragraph role="alert">{error}</Paragraph>}
      <Button
        disabled={busy}
        onClick={() => void refresh().catch(() => setError('Refresh failed.'))}
      >
        Refresh saved evidence
      </Button>
      {snapshot && (
        <>
          <MediaUpload
            disabled={disabled || busy}
            revision={snapshot.revision}
            onDirtyChange={reportUploadDirty}
            refresh={refresh}
            upload={(file, key, revision) =>
              client.upload(batch.id, revision, file.name, file, key)
            }
          />
          {subject && (
            <label>
              Attachment for {subject.label}
              <select
                disabled={frozen}
                value={selection?.version_id ?? selection?.mode ?? 'unset'}
                onChange={(event) => {
                  const value = event.target.value
                  const mode = value === 'unset' || value === 'declined' ? value : 'selected'
                  void edit({
                    kind: 'select_attachment',
                    subject_id: subject.id,
                    mode,
                    version_id: mode === 'selected' ? value : null,
                    destination: 'lot_attachment',
                  }).catch(() => undefined)
                }}
              >
                <option value="unset">Not chosen</option>
                <option value="declined">No attachment for this lot</option>
                {snapshot.evidence.flatMap((evidence) =>
                  evidence.versions
                    .filter((version) => version.state === 'ready')
                    .map((version) => (
                      <option key={version.id} value={version.id}>
                        {evidence.label} · {version.kind}
                      </option>
                    )),
                )}
              </select>
            </label>
          )}
          <Small>
            {snapshot.evidence.length} retained files · {snapshot.groups.length} groups
          </Small>
          {snapshot.derivations
            .filter((item) => item.state !== 'ready')
            .map((item) => (
              <Paragraph key={item.id} role="status">
                Crop preparation: {item.state.replaceAll('_', ' ')}
              </Paragraph>
            ))}
          {snapshot.evidence.map((evidence) => (
            <div key={evidence.id}>
              <MediaEvidenceCard
                key={evidence.id}
                batchId={batch.id}
                evidence={evidence}
                disabled={frozen || uploadDirty}
                onCrop={(version, page) => {
                  reportCropDirty(true)
                  setCrop({ version, page })
                }}
              />
              <MediaEvidenceRelations
                batch={batch}
                snapshot={snapshot}
                evidence={evidence}
                disabled={frozen || uploadDirty}
                edit={edit}
                onDirtyChange={reportGroupDirty}
              />
            </div>
          ))}
          {!snapshot.evidence.length && (
            <Paragraph>No files yet. Human notes and known values remain available.</Paragraph>
          )}
        </>
      )}
      {crop && (
        <MediaCropDialog
          key={`${crop.version.id}:${crop.page}`}
          batchId={batch.id}
          version={crop.version}
          pageNumber={crop.page}
          onDirtyChange={reportCropDirty}
          close={() => {
            reportCropDirty(false)
            setCrop(null)
          }}
          save={(recipe) => edit({ kind: 'derive', evidence_id: crop.version.evidence_id, recipe })}
        />
      )}
    </section>
  )
}
