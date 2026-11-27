import type { ProcessingQuestionFigureDto } from '@invimport/contracts'
import { choiceQuestion } from './answered-questions'

export const F = {
  batch: '10000000-0000-4000-8000-000000000001',
  evidence: (n: number) => `e0000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
  version: (n: number) => `f0000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
}

/** A ready picture of photo `n`: a 500 × 280 region of a 4000 × 3000 page, shown at ×2. */
export function figure(
  n: number,
  extra: Partial<ProcessingQuestionFigureDto> = {},
): ProcessingQuestionFigureDto {
  return {
    source: {
      kind: 'evidence_page',
      evidence_id: F.evidence(n),
      version_id: F.version(n),
      page: 1,
    },
    view: {
      region: { x: 1840, y: 1210, width: 500, height: 280 },
      quarter_turns: 0,
      straighten_millidegrees: 0,
    },
    marks: [],
    caption: `Picture caption ${n}`,
    why: `Why picture ${n} is shown.`,
    state: 'ready',
    evidence_label: `IMG_30${n.toString().padStart(2, '0')}`,
    document: false,
    page_width: 4000,
    page_height: 3000,
    ...extra,
  }
}

/** The four pictures of the worn ATmega marking; the first is boxed and labelled. */
export function wornSuffixFigures(): ProcessingQuestionFigureDto[] {
  return [
    figure(20, {
      caption: 'The worn suffix, boxed',
      why: 'The last letters are worn; the box covers the B that tells the variants apart.',
      view: {
        region: { x: 1840, y: 1210, width: 300, height: 160 },
        quarter_turns: 1,
        straighten_millidegrees: 0,
      },
      marks: [
        {
          kind: 'box',
          geometry: { x: 7000, y: 3000, width: 2000, height: 2500 },
          label: 'the suffix in doubt',
        },
        { kind: 'label', at: { x: 6000, y: 8000 }, label: 'Worn: B or nothing?' },
      ],
    }),
    figure(21, {
      caption: 'The slip, line 3',
      marks: [
        {
          kind: 'highlight',
          geometry: { x: 500, y: 3000, width: 9000, height: 1500 },
          label: 'line 3',
        },
      ],
    }),
    figure(22, {
      caption: 'Datasheet ordering table',
      source: {
        kind: 'evidence_page',
        evidence_id: F.evidence(22),
        version_id: F.version(22),
        page: 12,
      },
      document: true,
    }),
    figure(23, {
      caption: 'The whole board',
      view: {
        region: { x: 0, y: 0, width: 4000, height: 3000 },
        quarter_turns: 0,
        straighten_millidegrees: 0,
      },
      marks: [
        { kind: 'arrow', geometry: { from: { x: 2000, y: 9000 }, to: { x: 4000, y: 6000 } } },
      ],
    }),
  ]
}

/** The one-step variant question, carrying the given pictures. */
export function figuresQuestion(figures: ProcessingQuestionFigureDto[], n = 7) {
  return choiceQuestion(n, {
    figures,
    steps: [
      {
        id: 'variant',
        prompt: 'Which ATmega328P variant is this?',
        assumption: 'Working on ATmega328P-AU.',
        answer: {
          kind: 'choice',
          options: [
            { id: 'p', label: 'ATmega328P-AU' },
            { id: 'pb', label: 'ATmega328PB-AU' },
          ],
          other: true,
        },
      },
    ],
  })
}
