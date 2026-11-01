import { mediaIdentityLabels } from '../../media/identity-labels'
import { useQuery } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { RETAINED_POLL_INTERVAL_MS } from '../../queries/client'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import styled from 'styled-components'
import type { CaptureSnapshotDto, MediaEditDto, MediaVersionDto } from '@invimport/contracts'
import { Button, Heading, Label, Paragraph, Select, Small } from '../ui/primitives'
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
  const scope = useServerScope()
  const attachmentControlId = useId()
  const attachmentDescriptionId = `${attachmentControlId}-selection`
  const mediaQuery = useQuery({
    queryKey: serverQueryKey(scope, 'media', batch.id),
    queryFn: () => client.snapshot(batch.id),
    refetchInterval: RETAINED_POLL_INTERVAL_MS,
  })
  const snapshot = mediaQuery.data
  const readUnavailable =
    mediaQuery.isError || mediaQuery.fetchStatus === 'paused' || !mediaQuery.isFetchedAfterMount
  const { refetch } = mediaQuery
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploadDirty, setUploadDirty] = useState(false)
  const [, setCropDirty] = useState(false)
  const [crop, setCrop] = useState<{
    version: MediaVersionDto
    page: number
    revision: string
  } | null>(null)

  const dirtyFlags = useRef({ upload: false, crop: false, command: false })
  const dirtyGroups = useRef(new Set<string>())

  const reportUploadDirty = useCallback(
    (dirty: boolean) => {
      dirtyFlags.current.upload = dirty
      setUploadDirty(dirty)
      onDirtyChange(
        dirtyFlags.current.upload ||
          dirtyFlags.current.crop ||
          dirtyFlags.current.command ||
          dirtyGroups.current.size > 0,
      )
    },
    [onDirtyChange],
  )

  const reportCropDirty = useCallback(
    (dirty: boolean) => {
      dirtyFlags.current.crop = dirty
      setCropDirty(dirty)
      onDirtyChange(
        dirtyFlags.current.upload ||
          dirtyFlags.current.crop ||
          dirtyFlags.current.command ||
          dirtyGroups.current.size > 0,
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
        dirtyFlags.current.upload ||
          dirtyFlags.current.crop ||
          dirtyFlags.current.command ||
          dirtyGroups.current.size > 0,
      )
    },
    [onDirtyChange],
  )

  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const refresh = useCallback(async () => {
    const result = await refetch({ throwOnError: true })
    if (!result.data) {
      throw new Error('media_snapshot_missing')
    }
  }, [refetch])

  async function submitEdit(input: MediaEditDto, key: string) {
    if (readUnavailable || disabled) {
      throw new Error('current_media_read_required')
    }
    dirtyFlags.current.command = true
    onDirtyChange(true)
    setBusy(true)
    setError('')
    try {
      await client.edit(batch.id, input, key)
      await refresh()
    } catch (failure) {
      setError(
        'Media change was not confirmed. Refresh saved evidence before deciding whether to submit again.',
      )
      throw failure
    } finally {
      dirtyFlags.current.command = false
      onDirtyChange(
        dirtyFlags.current.upload || dirtyFlags.current.crop || dirtyGroups.current.size > 0,
      )
      setBusy(false)
    }
  }

  function edit(change: MediaEditDto['change'], intent?: { key: string; revision: string }) {
    if (!snapshot) {
      throw new Error('media_not_loaded')
    }
    return submitEdit(
      { expected_revision: intent?.revision ?? snapshot.revision, change },
      intent?.key ?? crypto.randomUUID(),
    )
  }

  const subject = batch.lots.find((lot) => lot.id === selectedSubject)
  const selection = snapshot?.attachments.find((item) => item.subject_id === selectedSubject)
  const identityLabels = mediaIdentityLabels(snapshot?.evidence ?? [])
  let attachmentDescription = 'Not chosen'
  if (selection?.version_id) {
    attachmentDescription =
      identityLabels.versions.get(selection.version_id) ?? `Saved version ${selection.version_id}`
  } else if (selection?.mode === 'declined') {
    attachmentDescription = 'No attachment for this lot'
  }
  const frozen = disabled || busy || !snapshot || readUnavailable

  return (
    <section aria-labelledby="retained-evidence-title">
      <Heading id="retained-evidence-title">Photos and documents</Heading>
      <Paragraph>
        Evidence can support several lots or shared Parts. Grouping does not create stock.
      </Paragraph>
      {readUnavailable && (
        <Paragraph role="alert">
          Current saved media could not be confirmed. File and crop inputs are preserved;
          preparation and media changes remain blocked until a fresh read succeeds.
        </Paragraph>
      )}
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
            disabled={frozen}
            revision={snapshot.revision}
            onDirtyChange={reportUploadDirty}
            refresh={refresh}
            upload={(file, key, revision) =>
              client.upload(batch.id, revision, file.name, file, key)
            }
          />
          {subject && (
            <AttachmentChoice>
              <Label htmlFor={attachmentControlId}>Attachment for {subject.label}</Label>
              <Select
                id={attachmentControlId}
                aria-describedby={attachmentDescriptionId}
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
                        {identityLabels.versions.get(version.id)}
                      </option>
                    )),
                )}
              </Select>
              <Small id={attachmentDescriptionId}>
                Selected attachment: {attachmentDescription}
              </Small>
            </AttachmentChoice>
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
                labels={identityLabels}
                key={evidence.id}
                batchId={batch.id}
                evidence={evidence}
                disabled={frozen || uploadDirty}
                onCrop={(version, page) => {
                  reportCropDirty(true)
                  setCrop({ version, page, revision: snapshot.revision })
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
      {crop && snapshot && (
        <MediaCropDialog
          key={`${crop.version.id}:${crop.page}`}
          batchId={batch.id}
          version={crop.version}
          pageNumber={crop.page}
          revision={crop.revision}
          snapshot={snapshot}
          readUnavailable={readUnavailable || disabled}
          onDirtyChange={reportCropDirty}
          close={() => {
            reportCropDirty(false)
            setCrop(null)
          }}
          save={submitEdit}
        />
      )}
    </section>
  )
}

const AttachmentChoice = styled.div`
  display: grid;
  gap: 6px;
  width: 100%;
  min-width: 0;
  max-width: 100%;

  label {
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  select {
    max-width: 100%;
  }
`
