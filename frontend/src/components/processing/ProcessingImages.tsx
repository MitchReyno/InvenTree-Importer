import { useQuery } from '@tanstack/react-query'
import styled from 'styled-components'
import { color, size, space } from '../../theme/generated/tokens'
import type { MediaClient } from '../../media/types'
import { mediaResource } from '../../media/types'
import { mediaDisplayLabels } from '../../media/identity-labels'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { useRetainedPollInterval } from '../operations/LiveUpdates'
import { EvidenceViewer } from '../operator/EvidenceViewer'
import { Heading, Link, Panel, Paragraph, Small } from '../ui/primitives'
import { Banner } from '../ui/Banner'
import { batchHref } from '../../navigation/batch-route'

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
  const labels = query.data ? mediaDisplayLabels(query.data.evidence) : undefined
  if (!client) {
    return <Banner tone="plain">Retained media is not configured for this application.</Banner>
  }
  return (
    <section aria-label="Retained image outputs">
      <Heading>Originals and documentary crops</Heading>
      <Paragraph>
        Inspect saved outputs before choosing attachments. A prepared crop is not an approved
        inventory effect.
      </Paragraph>
      <Link href={batchHref(batchId, { tab: 'capture' })}>
        Add evidence or prepare another crop in Capture
      </Link>
      {unavailable && (
        <div role="alert">
          <Banner tone="bad">
            Current media status is unavailable. Any displayed outputs are the last retained
            snapshot.
          </Banner>
        </div>
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
            <Heading>{labels?.evidence.get(source.id) ?? source.label}</Heading>
            <Small>
              {source.versions.length} retained versions · {source.linked_subject_ids.length} linked
              subjects
            </Small>
            <EvidenceViewer
              batchId={batchId}
              evidence={[source]}
              labels={labels}
              unavailable={unavailable}
            />
            <Versions aria-label={`Versions of ${labels?.evidence.get(source.id) ?? source.label}`}>
              {source.versions.map((version) => (
                <div key={version.id}>
                  <strong>{version.kind === 'original' ? 'Original' : 'Documentary crop'}</strong>
                  <Small>
                    {version.state} · {version.pages.length} pages
                  </Small>
                  {version.state === 'ready' && version.pages[0] && (
                    <Link
                      href={mediaResource(batchId, 'previews', version.pages[0].preview_id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open exact {version.kind === 'original' ? 'original' : 'crop'} preview
                    </Link>
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
  gap: ${space[8]};
  margin-top: ${space[7]};
  overflow-wrap: anywhere;
`
const Versions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[6]};
  padding-top: ${space[6]};
  border-top: 1px solid ${color.line};
  a {
    display: inline-flex;
    align-items: center;
    min-height: ${size.touch};
    color: ${color.accent};
  }
`
