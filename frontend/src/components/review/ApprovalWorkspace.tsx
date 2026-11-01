import styled from 'styled-components'
import type { CaptureSnapshotDto, ManualPreviewDto } from '@invimport/contracts'
import {
  Button,
  Caption,
  Heading,
  Panel,
  Paragraph,
  Small,
  Notice,
  Field,
  Summary,
  Select,
  Label,
} from '../ui/primitives'

interface Props {
  batch: CaptureSnapshotDto
  preparations: ManualPreviewDto[]
  preview: ManualPreviewDto | null
  pinnedPreparationId?: string
  busy: boolean
  choose: (preview: ManualPreviewDto) => void
  approve: () => void
  review: () => void
}

export function ApprovalWorkspace({
  batch,
  preparations,
  preview,
  pinnedPreparationId,
  busy,
  choose,
  approve,
  review,
}: Props) {
  const current = preview && preparations.some((value) => value.id === preview.id)
  const parts = [
    ...new Map(preview?.effects.map((value) => [value.part_id, value.part_label]) ?? []).entries(),
  ]
  return (
    <ApprovalGrid>
      <Panel>
        <Heading>Choose the prepared scope</Heading>
        <Caption>
          Approval covers the exact frozen effects. Editing selected dependencies requires a new
          review and preparation.
        </Caption>
        {preparations.length > 0 && (
          <Label>
            Prepared selection
            <Select
              value={current ? preview.id : ''}
              onChange={(event) => {
                const value = preparations.find((item) => item.id === event.target.value)
                if (value) {
                  choose(value)
                }
              }}
            >
              <option value="">Choose a prepared selection</option>
              {preparations.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.effects.map((effect) => effect.lot_label).join(', ')}
                </option>
              ))}
            </Select>
          </Label>
        )}
        {preview ? (
          <>
            <Paragraph>
              <strong>
                Included · {preview.effects.length} physical lot
                {preview.effects.length === 1 ? '' : 's'}
              </strong>
            </Paragraph>
            {preview.effects.map((effect) => (
              <Field key={effect.lot_id}>
                <strong>{effect.lot_label}</strong>
                <Small>
                  {effect.quantity} pieces · {effect.location_label}
                </Small>
              </Field>
            ))}
            <Paragraph>
              <strong>Not included</strong>
            </Paragraph>
            {preview.remaining_lot_ids.length ? (
              <ul>
                {preview.remaining_lot_ids.map((id) => (
                  <li key={id}>
                    {batch.lots.find((value) => value.id === id)?.label ?? 'Another physical lot'}
                  </li>
                ))}
              </ul>
            ) : (
              <Small>No other physical lots in this captured batch.</Small>
            )}
          </>
        ) : (
          <Paragraph>
            No current prepared selection. Review exact saved choices and prepare the scope first.
          </Paragraph>
        )}
        <Button disabled={busy} onClick={review}>
          Back to Review
        </Button>
      </Panel>
      <Panel>
        <Heading>What will change in the owned fake</Heading>
        <Notice>
          Only the isolated owned fake is qualified. This approval cannot write to the real
          InvenTree server.
        </Notice>
        {preview && (
          <>
            <Paragraph>
              <strong>Reuse existing Parts · {parts.length}</strong>
            </Paragraph>
            <ul>
              {parts.map(([id, label]) => (
                <li key={id}>
                  {label} · Part #{id}
                  <Small>Shared prerequisite; no Part is created or overwritten.</Small>
                </li>
              ))}
            </ul>
            <Paragraph>
              <strong>Create stock · {preview.effects.length}</strong>
            </Paragraph>
            {preview.effects.map((effect) => (
              <Effect key={effect.lot_id}>
                <strong>
                  {effect.quantity} × {effect.lot_label}
                </strong>
                <Small>
                  Existing Part #{effect.part_id} · {effect.location_label}
                  {effect.location_id ? ` (#${effect.location_id})` : ''}
                </Small>
                <Small>Original contribution preserved.</Small>
              </Effect>
            ))}
            <details>
              <Summary>Exact approval binding and original keys</Summary>
              <Binding>
                <Paragraph>Plan {preview.plan_sha256}</Paragraph>
                <Paragraph>Review {preview.review_fingerprint}</Paragraph>
                {preview.effects.map((effect) => (
                  <Paragraph key={effect.lot_id}>
                    {effect.lot_label}: {effect.barcode}
                  </Paragraph>
                ))}
              </Binding>
            </details>
          </>
        )}
        {pinnedPreparationId && !current && (
          <Notice>
            The pinned preparation is unavailable, stale or already approved. No other plan has been
            substituted. Inspect Results, return to Review or explicitly choose another prepared
            selection.
          </Notice>
        )}
        <ApproveFoot>
          <Small>
            Approval retains one original run. A separate supervised runner performs only explicitly
            queued work.
          </Small>
          <Button disabled={busy || !preview || !current || batch.archived} onClick={approve}>
            Approve {preview?.effects.length ?? 0} lot{preview?.effects.length === 1 ? '' : 's'} for
            the owned fake
          </Button>
        </ApproveFoot>
      </Panel>
    </ApprovalGrid>
  )
}

const ApprovalGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(250px, 1fr) minmax(300px, 1.25fr);
  gap: 16px;
  align-items: start;
  @media (max-width: 700px) {
    display: block;
  }
`
const Effect = styled.div`
  padding: 14px 0;
  border-top: 1px solid #e0e5ed;
`
const Binding = styled.div`
  font-size: 12px;
  overflow-wrap: anywhere;
`
const ApproveFoot = styled.div`
  display: grid;
  gap: 12px;
  border-top: 1px solid #d5dce5;
  padding-top: 16px;
  margin-top: 16px;
`
