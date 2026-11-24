import { useState } from 'react'
import styled from 'styled-components'
import type { ProcessingQuestionFigureDto } from '@invimport/contracts'
import { questionFigureImage, type QuestionFigureSize } from '#/media/types'
import { space } from '#/theme/generated/tokens'
import { FigureThumbnails } from './FigureThumbnails'
import { FigureTile } from './FigureTile'
import { QuestionFigureDialog } from './QuestionFigureDialog'

export type QuestionFiguresProps = {
  figures: readonly ProcessingQuestionFigureDto[]
  batchId: string
  jobId: string
  questionId: string
  /** The question's title, which the larger view names beside each picture. */
  questionTitle: string
  /** The lot the question is about, when it is one. */
  lot?: string
  /** Where "Add a photo" goes. */
  captureHref: string
}

const PAIR_BADGES = ['A', 'B']

/** One picture fills the card, two compare side by side, more show one with a strip. */
function galleryLayout(count: number) {
  if (count === 1) {
    return 'single'
  }
  return count === 2 ? 'pair' : 'strip'
}

/**
 * The agent's pictures for a question, in its order: one at full width, two side by side, or
 * three to five as one large picture with a thumbnail strip. Each opens the larger view.
 */
export function QuestionFigures(props: QuestionFiguresProps) {
  const { figures, batchId, jobId, questionId } = props
  const [shown, setShown] = useState(0)
  // The picture the larger view opened on, or null while it is closed.
  const [opened, setOpened] = useState<number | null>(null)
  const count = figures.length
  const layout = galleryLayout(count)
  const current = Math.min(shown, count - 1)

  const src = (index: number, size: QuestionFigureSize) =>
    questionFigureImage(batchId, jobId, questionId, index + 1, size)

  function tile(index: number, badge?: string) {
    return (
      <FigureTile
        key={index}
        figure={figures[index]}
        index={index}
        count={count}
        src={src(index, 'view')}
        badge={badge}
        onOpen={() => setOpened(index)}
      />
    )
  }

  return (
    <>
      <Gallery
        role="group"
        aria-label={
          count === 1 ? 'Picture for this question' : `${count} pictures for this question`
        }
        data-layout={layout}
      >
        {layout === 'single' && tile(0)}
        {layout === 'pair' && figures.map((_, index) => tile(index, PAIR_BADGES[index]))}
        {layout === 'strip' && (
          <>
            {tile(current, `${current + 1} / ${count}`)}
            <FigureThumbnails
              figures={figures}
              current={current}
              onSelect={setShown}
              label="Pictures"
              thumbSrc={(index) => src(index, 'thumb')}
            />
          </>
        )}
      </Gallery>
      {opened !== null && (
        <QuestionFigureDialog
          {...props}
          initial={opened}
          src={src}
          onClose={() => setOpened(null)}
        />
      )}
    </>
  )
}

const Gallery = styled.div`
  display: grid;
  gap: ${space[4]};
  min-width: 0;
  &[data-layout='pair'] {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
  }
`
