import type { MediaIdentityLabels } from '../../media/identity-labels'
import styled from 'styled-components'
import { color } from '../../theme/generated/tokens'
import type { MediaEvidenceDto, MediaVersionDto } from '@invimport/contracts'
import { Paragraph, Small, Subheading } from '../ui/primitives'
import { Button } from '../ui/Button'
import { mediaResource } from '../../media/types'
import { previewImage } from '../../media/images'

interface Props {
  labels: MediaIdentityLabels
  batchId: string
  evidence: MediaEvidenceDto
  disabled: boolean
  onCrop: (version: MediaVersionDto, page: number) => void
}

export function MediaEvidenceCard({ batchId, evidence, disabled, onCrop, labels }: Props) {
  return (
    <Card>
      <Subheading>{labels.evidence.get(evidence.id)}</Subheading>
      {evidence.versions.map((version) => (
        <Version key={version.id}>
          <Small>
            {labels.versions.get(version.id)} · {version.state.replaceAll('_', ' ')}
          </Small>
          {version.pages.map((page) => (
            <figure key={page.page}>
              <Preview
                // Contained within 280 px of height, so a wide page shows no wider than this.
                {...previewImage(
                  batchId,
                  page,
                  'card',
                  `min(100vw, ${Math.ceil((280 * page.width) / page.height)}px)`,
                )}
                loading="lazy"
                decoding="async"
                alt={`${evidence.label}, ${version.kind}, page ${page.page}`}
              />
              <figcaption>
                {page.width} × {page.height} source pixels · page {page.page}
              </figcaption>
              {version.kind === 'original' && (
                <Button disabled={disabled} onClick={() => onCrop(version, page.page)}>
                  Prepare crop / rotation
                </Button>
              )}
            </figure>
          ))}
          <a href={mediaResource(batchId, 'versions', version.id)} download>
            Download retained {version.kind}
          </a>
          <details>
            <summary>Retained byte identity</summary>
            <Paragraph>
              {version.byte_size} bytes · SHA-256 {version.digest}
            </Paragraph>
            {version.decoder_build && <Paragraph>{version.decoder_build}</Paragraph>}
          </details>
        </Version>
      ))}
    </Card>
  )
}

const Card = styled.article`
  display: grid;
  gap: 10px;
  border: 1px solid ${color.line};
  border-radius: 5px;
  padding: 12px;
  margin: 12px 0;
`

const Version = styled.div`
  display: grid;
  gap: 8px;
  overflow-wrap: anywhere;

  figure {
    display: grid;
    gap: 8px;
    margin: 0;
  }

  figcaption {
    font-size: 12px;
    color: ${color.muted};
  }
`

const Preview = styled.img`
  display: block;
  width: 100%;
  /* Auto keeps the box to the image's ratio; the attributes only reserve space while loading. */
  height: auto;
  max-height: 280px;
  object-fit: contain;
  background: ${color.photoStage};
`
