import { useQuery } from '@tanstack/react-query'
import styled from 'styled-components'
import type { MediaClient } from '../../media/types'
import { mediaResource } from '../../media/types'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { useRetainedPollInterval } from '../operations/LiveUpdates'
import { EvidenceViewer } from '../operator/EvidenceViewer'
import { Heading, Link, Notice, Panel, Paragraph, Small } from '../ui/primitives'

export function ProcessingImages({ batchId, client }: { batchId: string; client?: MediaClient }) {
  const scope = useServerScope()
  const interval = useRetainedPollInterval()
  const query = useQuery({
    queryKey: serverQueryKey(scope, 'media', batchId),
    queryFn: () => client!.snapshot(batchId),
    enabled: client !== undefined,
    refetchInterval: interval,
  })
  const unavailable = query.isError || query.fetchStatus === 'paused'
  if (!client) {
    return <Notice>Retained media is not configured for this application.</Notice>
  }
  return (
    <section aria-label="Retained image outputs">
      <Heading>Originals and documentary crops</Heading>
      <Paragraph>
        Inspect saved outputs before choosing attachments. A prepared crop is not an approved
        inventory effect.
      </Paragraph>
      <Link href={`#${batchId}/capture`}>Add evidence or prepare another crop in Capture</Link>
      {unavailable && (
        <Notice role="alert">
          Current media status is unavailable. Any displayed outputs are the last retained snapshot.
        </Notice>
      )}
      {!query.data && !unavailable && (
        <Paragraph role="status">Loading retained image outputs…</Paragraph>
      )}
      {query.data?.evidence.length === 0 && !unavailable && (
        <Paragraph>No retained images or documents yet.</Paragraph>
      )}
      <Gallery>
        {query.data?.evidence.map((source) => (
          <Panel key={source.id}>
            <Heading>{source.label}</Heading>
            <Small>
              {source.versions.length} retained versions · {source.linked_subject_ids.length} linked
              subjects
            </Small>
            <EvidenceViewer batchId={batchId} evidence={[source]} unavailable={unavailable} />
            <Versions aria-label={`Versions of ${source.label}`}>
              {source.versions.map((version) => (
                <div key={version.id}>
                  <strong>{version.kind === 'original' ? 'Original' : 'Documentary crop'}</strong>
                  <Small>
                    {version.state} · {version.pages.length} pages
                  </Small>
                  {version.state === 'ready' && version.pages[0] && (
                    <a
                      href={mediaResource(batchId, 'previews', version.pages[0].preview_id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open exact {version.kind === 'original' ? 'original' : 'crop'} preview
                    </a>
                  )}
                </div>
              ))}
            </Versions>
          </Panel>
        ))}
      </Gallery>
    </section>
  )
}

const Gallery = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
  gap: 16px;
  margin-top: 14px;
`
const Versions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid #d5dce5;
  a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: #164a93;
  }
`
