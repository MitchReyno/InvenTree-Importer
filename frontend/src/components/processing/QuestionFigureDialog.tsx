import { useId, useState, type KeyboardEvent } from 'react'
import styled from 'styled-components'
import {
  Button,
  ChevronLeftIcon,
  ChevronRightIcon,
  Link,
  media,
  MinusIcon,
  ModalFrame,
  ModalTitle,
  PlusIcon,
  Switch,
} from '#/components/ui'
import type { QuestionFigureSize } from '#/media/types'
import { batchHref } from '#/navigation/batch-route'
import { figureAspect, figureShownLine, markText, pageBadge } from '#/processing/question-figures'
import {
  color,
  icon,
  opacity,
  radius,
  ring,
  size,
  space,
  type,
  typeVar,
} from '#/theme/generated/tokens'
import { FigurePicture } from './FigurePicture'
import { FigureThumbnails } from './FigureThumbnails'
import { FigureWholePage } from './FigureWholePage'
import type { QuestionFiguresProps } from './QuestionFigures'

type Props = QuestionFiguresProps & {
  /** The picture the dialog opens on, counting from 0. */
  initial: number
  src: (index: number, size: QuestionFigureSize) => string
  onClose: () => void
}

/** Zoom levels relative to the picture fitted to the stage. */
const ZOOM_LEVELS = [100, 150, 200, 300, 400]
const FIT = ZOOM_LEVELS[0]
/** The stage's height; a fitted picture is as large as fits in it. */
const STAGE_HEIGHT = 'min(60vh, 560px)'

/**
 * A larger view of a question's pictures: zoom, Fit and the whole page, previous and next with
 * the thumbnails and the arrow keys, the agent's marks on or off, why it shows the picture, its
 * marks in words, where it came from, and the way to Capture.
 */
export function QuestionFigureDialog({
  figures,
  batchId,
  questionTitle,
  lot,
  captureHref,
  initial,
  src,
  onClose,
}: Props) {
  const titleId = useId()
  const [index, setIndex] = useState(initial)
  // Kept while moving between pictures, so hidden marks stay hidden.
  const [showMarks, setShowMarks] = useState(true)
  const [zoom, setZoom] = useState(FIT)
  const [whole, setWhole] = useState(false)
  const count = figures.length
  const shown = Math.min(index, count - 1)
  const figure = figures[shown]
  const removed = figure.state === 'removed'
  const photoHref = batchHref(batchId, { tab: 'capture', photoId: figure.source.evidence_id })
  const photoLabel = figure.evidence_label ?? 'The photo'
  const aspect = whole
    ? { width: figure.page_width, height: figure.page_height }
    : figureAspect(figure)
  const marks = figure.marks ?? []
  const page = pageBadge(figure)

  function show(next: number) {
    if (next < 0 || next >= count) {
      return
    }
    setIndex(next)
    setZoom(FIT)
    setWhole(false)
  }

  function zoomBy(direction: 1 | -1) {
    const position = ZOOM_LEVELS.indexOf(zoom)
    setZoom(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, position + direction))])
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // The thumbnail strip handles its own arrows.
    if (event.defaultPrevented) {
      return
    }
    if (event.key === 'ArrowLeft') {
      show(shown - 1)
    } else if (event.key === 'ArrowRight') {
      show(shown + 1)
    } else {
      return
    }
    event.preventDefault()
  }

  return (
    <ModalFrame wide onClose={onClose} labelledBy={titleId}>
      {/* Focusable by click, so the arrow keys still move after a click on the picture. */}
      <Body tabIndex={-1} onKeyDown={handleKeyDown}>
        <Header>
          <Titles>
            <ModalTitle asChild>
              <Title id={titleId} tabIndex={-1}>
                {figure.caption}
              </Title>
            </ModalTitle>
            <Muted>
              Picture {shown + 1} of {count} · {questionTitle}
            </Muted>
          </Titles>
          <Switch label="Show the agent’s marks" checked={showMarks} onChange={setShowMarks} />
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </Header>
        <Columns>
          <Main>
            <StageFrame>
              <Stage data-testid="figure-stage">
                <Canvas $ratio={aspect.width / aspect.height} $zoom={zoom / 100}>
                  {whole ? (
                    <FigureWholePage figure={figure} batchId={batchId} />
                  ) : (
                    <FigurePicture figure={figure} src={src(shown, 'view')} showMarks={showMarks} />
                  )}
                </Canvas>
              </Stage>
              {page && <PageBadge>{page}</PageBadge>}
              {count > 1 && (
                <>
                  <Nav
                    type="button"
                    $side="left"
                    aria-label="Previous picture"
                    aria-disabled={shown === 0}
                    onClick={() => show(shown - 1)}
                  >
                    <ChevronLeftIcon />
                  </Nav>
                  <Nav
                    type="button"
                    $side="right"
                    aria-label="Next picture"
                    aria-disabled={shown === count - 1}
                    onClick={() => show(shown + 1)}
                  >
                    <ChevronRightIcon />
                  </Nav>
                </>
              )}
              <Tools role="group" aria-label="Zoom">
                <Tool
                  type="button"
                  aria-label="Zoom out"
                  aria-disabled={zoom === FIT}
                  onClick={() => zoomBy(-1)}
                >
                  <MinusIcon />
                </Tool>
                <Level aria-live="polite">{zoom}%</Level>
                <Tool
                  type="button"
                  aria-label="Zoom in"
                  aria-disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
                  onClick={() => zoomBy(1)}
                >
                  <PlusIcon />
                </Tool>
                <Tool
                  type="button"
                  $text
                  aria-label="Fit to the window"
                  onClick={() => setZoom(FIT)}
                >
                  Fit
                </Tool>
                <Tool
                  type="button"
                  $text
                  aria-label="Show the whole original photo"
                  aria-pressed={whole}
                  onClick={() => setWhole(!whole)}
                >
                  Whole photo
                </Tool>
              </Tools>
            </StageFrame>
            {count > 1 && (
              <FigureThumbnails
                figures={figures}
                current={shown}
                onSelect={show}
                label="Pictures for this question"
                thumbSrc={(thumb) => src(thumb, 'thumb')}
                showMarks={showMarks}
                large
              />
            )}
          </Main>
          <Aside aria-label="About this picture">
            <Section>
              <Label>Why the agent shows this</Label>
              <p>{figure.why}</p>
            </Section>
            <Section>
              <Label>Marks</Label>
              {marks.length > 0 ? (
                <Marks aria-label="Marks">
                  {marks.map((mark, markIndex) => (
                    <li key={markIndex}>
                      <Swatch aria-hidden="true" />
                      {markText(mark)}
                    </li>
                  ))}
                </Marks>
              ) : (
                <Muted>No marks on this picture.</Muted>
              )}
            </Section>
            <Facts>
              <dt>From</dt>
              <dd>
                {removed ? `${photoLabel} (removed)` : <Link href={photoHref}>{photoLabel}</Link>}
                {lot && ` · ${lot}`}
              </dd>
              <dt>Shown</dt>
              <dd>{figureShownLine(figure)}</dd>
            </Facts>
            <Muted>
              The original isn’t changed. Open it in Capture to see the whole photo or add a better
              one.
            </Muted>
            <Actions>
              {!removed && (
                <Button as="a" size="sm" href={photoHref}>
                  Open in Capture
                </Button>
              )}
              <Button as="a" size="sm" variant="ghost" href={captureHref}>
                Add a photo
              </Button>
            </Actions>
          </Aside>
        </Columns>
      </Body>
    </ModalFrame>
  )
}

const Body = styled.div`
  outline: none;
  display: flex;
  flex-direction: column;
  gap: ${space[6]};
`

const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[5]};
`

const Titles = styled.div`
  display: flex;
  flex: 1 1 16rem;
  flex-direction: column;
  min-width: 0;
  overflow-wrap: anywhere;
`

const Title = styled.h2`
  margin: 0;
  ${type.h2}
`

const Muted = styled.span`
  color: ${color.muted};
  font-size: ${typeVar.small.size};
`

const Columns = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 300px);
  gap: ${space[8]};
  ${media.stacked} {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Main = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[4]};
  min-width: 0;
`

const StageFrame = styled.div`
  position: relative;
  border-radius: ${radius.card};
  overflow: hidden;
  background: ${color.photoStage};
`

const Stage = styled.div`
  display: flex;
  height: ${STAGE_HEIGHT};
  overflow: auto;
`

/** Auto margins centre a fitted picture and keep every edge of a zoomed one scrollable. */
const Canvas = styled.div<{ $ratio: number; $zoom: number }>`
  flex: none;
  margin: auto;
  width: calc(min(100%, ${STAGE_HEIGHT} * ${({ $ratio }) => $ratio}) * ${({ $zoom }) => $zoom});
`

const PageBadge = styled.span`
  position: absolute;
  top: ${space[4]};
  right: ${space[4]};
  padding: ${space[1]} ${space[3]};
  border-radius: ${radius.pill};
  background: ${color.surface};
  color: ${color.fg};
  ${type.pill}
  line-height: 1;
`

// Limits use aria-disabled rather than disabled, so a control pressed to its limit keeps focus.
const Nav = styled.button<{ $side: 'left' | 'right' }>`
  position: absolute;
  top: 50%;
  ${({ $side }) => $side}: ${space[4]};
  display: grid;
  place-items: center;
  width: ${size.touch};
  height: ${size.touch};
  transform: translateY(-50%);
  border: 0;
  border-radius: ${radius.round};
  background: ${color.surface};
  color: ${color.fg};
  cursor: pointer;
  svg {
    width: ${icon.md};
    height: ${icon.md};
  }
  &[aria-disabled='true'] {
    opacity: ${opacity.disabled};
    cursor: not-allowed;
  }
  &:focus-visible {
    outline: ${ring.width} solid ${color.accent};
    outline-offset: ${ring.offset};
  }
`

const Tools = styled.div`
  position: absolute;
  left: ${space[4]};
  bottom: ${space[4]};
  display: flex;
  align-items: center;
  gap: ${space[2]};
  padding: ${space[2]};
  border-radius: ${radius.input};
  background: ${color.photoScrim};
  color: ${color.photoFg};
`

const Tool = styled.button<{ $text?: boolean }>`
  display: grid;
  place-items: center;
  min-width: ${size.control};
  height: ${size.control};
  padding: 0 ${({ $text }) => ($text ? space[3] : '0')};
  border: 0;
  border-radius: ${radius.sm};
  background: transparent;
  color: inherit;
  ${type.pill}
  cursor: pointer;
  svg {
    width: ${icon.md};
    height: ${icon.md};
  }
  &[aria-pressed='true'] {
    background: ${color.accent};
    color: ${color.onAccent};
  }
  &[aria-disabled='true'] {
    opacity: ${opacity.disabled};
    cursor: not-allowed;
  }
  &:focus-visible {
    outline: ${ring.width} solid ${color.photoFg};
  }
`

const Level = styled.span`
  min-width: 3.5em;
  text-align: center;
  ${type.monoStrong}
`

const Aside = styled.aside`
  display: flex;
  flex-direction: column;
  gap: ${space[6]};
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: ${typeVar.body.size};
  p {
    margin: 0;
  }
`

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
`

const Label = styled.h3`
  margin: 0;
  ${type.label}
  color: ${color.muted};
`

const Marks = styled.ul`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  margin: 0;
  padding: 0;
  list-style: none;
  li {
    display: flex;
    align-items: center;
    gap: ${space[3]};
  }
`

const Swatch = styled.span`
  flex: none;
  width: ${space[5]};
  height: ${space[5]};
  border: 3px solid ${color.highlight};
  border-radius: ${radius.xs};
  box-sizing: border-box;
`

const Facts = styled.dl`
  display: grid;
  grid-template-columns: minmax(0, 5rem) minmax(0, 1fr);
  gap: ${space[2]} ${space[5]};
  margin: 0;
  dt {
    color: ${color.muted};
    font-size: ${typeVar.small.size};
  }
  dd {
    margin: 0;
    min-width: 0;
  }
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[3]};
`
