import styled from 'styled-components'
import type { ProcessingImageCropDto } from '@invimport/contracts'
import { cropAspect, cropStateText } from '#/processing/images-review'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { useRetriedImage } from './useRetriedImage'

type Props = {
  crop: ProcessingImageCropDto
  /** The crop route's rendering; asked for only once the crop is ready. */
  src: string
  alt: string
}

/** A proposed crop as the app rendered it, in a square stage; one not ready says why instead. */
export function CropPicture({ crop, src, alt }: Props) {
  const { imageSrc, failed, handleError, handleLoad } = useRetriedImage(src)
  const unavailable =
    cropStateText(crop.state) ?? (failed ? 'Picture couldn’t be loaded' : undefined)

  return (
    <Stage data-crop-state={crop.state}>
      {crop.state === 'ready' && (
        <Picture
          src={imageSrc}
          alt={alt}
          $ratio={cropAspect(crop.recipe)}
          draggable={false}
          hidden={failed}
          onError={handleError}
          onLoad={handleLoad}
        />
      )}
      {unavailable && <Placeholder>{unavailable}</Placeholder>}
    </Stage>
  )
}

const Stage = styled.div`
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  background: ${color.photoStage};
`

const Picture = styled.img<{ $ratio: string }>`
  display: block;
  max-width: 100%;
  max-height: 100%;
  aspect-ratio: ${({ $ratio }) => $ratio};
  object-fit: contain;
  &[hidden] {
    display: none;
  }
`

const Placeholder = styled.span`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: ${space[3]};
  color: ${color.photoFg};
  font-size: ${typeVar.small.size};
  text-align: center;
`
