import styled from 'styled-components'
import type { ProcessingImageCropDto } from '@invimport/contracts'
import { useId } from 'react'
import { Pill, Small } from '#/components/ui'
import { CheckboxLabel } from '#/forms'
import { imagesCropImage } from '#/media/types'
import {
  adjustmentChips,
  cropSourceLine,
  ROLE_LABEL,
  unchoosableReason,
  type ConfirmedPlacement,
} from '#/processing/images-review'
import { color, radius, space, type, typeVar } from '#/theme/generated/tokens'
import { CropPicture } from './CropPicture'

/** The crop's attach control: the Part image radio, the stock checkbox, or none for an extra. */
export type CropControl =
  | { kind: 'part'; name: string; checked: boolean; onChoose: () => void }
  | { kind: 'stock'; checked: boolean; onToggle: (checked: boolean) => void }
  | { kind: 'none' }

type Props = {
  batchId: string
  proposalId: string
  crop: ProcessingImageCropDto
  /** Where the crop already sits among the lot's confirmed images. */
  placement: ConfirmedPlacement | null
  control: CropControl
  /** Called with the picture's address once it has loaded. */
  onPictureLoaded: (src: string) => void
  /** Every control is locked, such as while a confirmation awaits its outcome. */
  disabled: boolean
}

function placementText(placement: ConfirmedPlacement) {
  const place = placement.kind === 'part' ? 'the Part image' : `stock image ${placement.position}`

  return `Confirmed as ${place} · ${placement.state}`
}

/** One proposed crop: the app's rendering, what it was cut from, how it was adjusted, its flags. */
export function ImagesCropCard({
  batchId,
  proposalId,
  crop,
  placement,
  control,
  onPictureLoaded,
  disabled,
}: Props) {
  const role = ROLE_LABEL[crop.role]
  const src = imagesCropImage(batchId, proposalId, crop.index, 'view')
  const reasonId = useId()
  const reason = unchoosableReason(crop.state)
  const checked = control.kind !== 'none' && control.checked
  // An unrendered crop can't be chosen, but one already chosen can still be unchosen.
  const controlDisabled = disabled || (reason !== undefined && !checked)
  const describedBy = reason ? reasonId : undefined

  return (
    <Card aria-label={`Crop ${crop.index}: ${role}`}>
      <CropPicture
        crop={crop}
        src={src}
        onLoaded={() => onPictureLoaded(src)}
        alt={`Crop ${crop.index}, ${role.toLowerCase()}, from ${crop.evidence_label}`}
      />
      <Body>
        <TitleRow>
          <Pill tone={crop.role === 'part_image' ? 'acc' : 'neutral'} glyph="">
            {role}
          </Pill>
          <strong>Crop {crop.index}</strong>
        </TitleRow>
        <Muted>{cropSourceLine(crop)}</Muted>
        <Chips aria-label="Adjustments">
          {adjustmentChips(crop.recipe).map((chip) => (
            <li key={chip}>{chip}</li>
          ))}
        </Chips>
        {crop.flags.length > 0 && (
          <Flags aria-label="Flags">
            {crop.flags.map((flag) => (
              <li key={flag}>
                <Pill tone="warn" glyph="!">
                  {flag}
                </Pill>
              </li>
            ))}
          </Flags>
        )}
        {placement && <Small>{placementText(placement)}</Small>}
        {control.kind === 'part' && (
          <CheckboxLabel>
            <input
              type="radio"
              name={control.name}
              checked={control.checked}
              disabled={controlDisabled}
              aria-describedby={describedBy}
              onChange={control.onChoose}
            />
            Use crop {crop.index} as the Part image
          </CheckboxLabel>
        )}
        {control.kind === 'stock' && (
          <CheckboxLabel>
            <input
              type="checkbox"
              checked={control.checked}
              disabled={controlDisabled}
              aria-describedby={describedBy}
              onChange={(event) => control.onToggle(event.target.checked)}
            />
            Attach crop {crop.index} to the stock
          </CheckboxLabel>
        )}
        {control.kind !== 'none' && reason && <Muted id={reasonId}>{reason}</Muted>}
        {control.kind === 'none' && (
          <Muted>Extras aren’t attached; crop it yourself in Capture to keep one.</Muted>
        )}
      </Body>
    </Card>
  )
}

const Card = styled.article`
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  padding: ${space[5]} ${space[6]};
  font-size: ${typeVar.small.size};
  overflow-wrap: anywhere;
`

const TitleRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
`

const Muted = styled.span`
  color: ${color.muted};
`

const Chips = styled.ul`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
  margin: 0;
  padding: 0;
  list-style: none;
  li {
    padding: ${space[1]} ${space[4]};
    border-radius: ${radius.pill};
    background: ${color.surface2};
    ${type.label}
  }
`

const Flags = styled.ul`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[2]};
  margin: 0;
  padding: 0;
  list-style: none;
`
