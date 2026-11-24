import type { ProcessingQuestionFigureDto } from '@invimport/contracts'

/**
 * The browser fixture's question pictures: one, two and four. The fixture has no server, so the
 * figure route answers nothing; a demo serves the images by intercepting that route.
 */

const evidence = (n: number) => `e0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`

const version = (n: number) => `f0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`

function picture(
  n: number,
  label: string,
  rest: Omit<
    ProcessingQuestionFigureDto,
    'source' | 'evidence_label' | 'document' | 'page_width' | 'page_height'
  >,
  page = 1,
): ProcessingQuestionFigureDto {
  return {
    source: { kind: 'evidence_page', evidence_id: evidence(n), version_id: version(n), page },
    evidence_label: label,
    document: page > 1,
    page_width: 4032,
    page_height: 3024,
    ...rest,
  }
}

/** One picture: the LM358 tube's date code, the digit in doubt circled. */
export const dateCodeFigures: ProcessingQuestionFigureDto[] = [
  picture(11, 'IMG_3011', {
    view: {
      region: { x: 1620, y: 1380, width: 420, height: 180 },
      quarter_turns: 1,
      straighten_millidegrees: -1800,
    },
    marks: [
      {
        kind: 'circle',
        geometry: { x: 7200, y: 2000, width: 1800, height: 6000 },
        label: 'the digit in doubt',
      },
    ],
    caption: 'The digit in doubt, circled',
    why: 'The last digit of the date code is half rubbed off; 2348 and 2346 both fit.',
    state: 'ready',
  }),
]

/** Two pictures: packets A and B's labels, their date codes highlighted. */
export const packetLabelFigures: ProcessingQuestionFigureDto[] = [
  picture(2, 'IMG_3002', {
    view: {
      region: { x: 900, y: 700, width: 1600, height: 1200 },
      quarter_turns: 0,
      straighten_millidegrees: 0,
    },
    marks: [
      {
        kind: 'highlight',
        geometry: { x: 800, y: 5200, width: 5000, height: 1600 },
        label: 'D/C 2341',
      },
    ],
    caption: 'Packet A: date code 2341',
    why: 'Same MPN as packet B; the date codes are what differ.',
    state: 'ready',
  }),
  picture(5, 'IMG_3005', {
    view: {
      region: { x: 1000, y: 760, width: 1600, height: 1200 },
      quarter_turns: 0,
      straighten_millidegrees: 0,
    },
    marks: [
      {
        kind: 'highlight',
        geometry: { x: 800, y: 5200, width: 5000, height: 1600 },
        label: 'D/C 2407',
      },
    ],
    caption: 'Packet B: date code 2407',
    why: 'Same MPN as packet A; the date codes are what differ.',
    state: 'ready',
  }),
]

/** Four pictures: the worn ATmega marking, the slip, a datasheet page and the whole board. */
export const wornSuffixFigures: ProcessingQuestionFigureDto[] = [
  picture(20, 'IMG_3020', {
    view: {
      region: { x: 1840, y: 1210, width: 900, height: 500 },
      quarter_turns: 0,
      straighten_millidegrees: 0,
    },
    marks: [
      {
        kind: 'box',
        geometry: { x: 7600, y: 3000, width: 1700, height: 2400 },
        label: 'the suffix in doubt',
      },
      { kind: 'label', at: { x: 6000, y: 8200 }, label: 'Worn: B or nothing?' },
    ],
    caption: 'The worn suffix, boxed',
    why: 'The last letters are worn. “P-AU” and “PB-AU” differ only in that B, which the box covers.',
    state: 'ready',
  }),
  picture(21, 'IMG_3021', {
    view: {
      region: { x: 400, y: 900, width: 3000, height: 1100 },
      quarter_turns: 0,
      straighten_millidegrees: 900,
    },
    marks: [
      {
        kind: 'highlight',
        geometry: { x: 400, y: 3600, width: 9200, height: 1400 },
        label: 'line 3',
      },
    ],
    caption: 'The slip, line 3',
    why: 'The packing slip lists the variant the supplier sent.',
    state: 'ready',
  }),
  picture(
    22,
    'ATmega328P datasheet',
    {
      view: {
        region: { x: 300, y: 1500, width: 3400, height: 900 },
        quarter_turns: 0,
        straighten_millidegrees: 0,
      },
      marks: [
        {
          kind: 'highlight',
          geometry: { x: 200, y: 4000, width: 9600, height: 2000 },
          label: 'the -AU ordering code',
        },
      ],
      caption: 'Datasheet ordering table',
      why: 'The ordering table shows which suffix goes with the TQFP package.',
      state: 'ready',
    },
    12,
  ),
  picture(23, 'IMG_3023', {
    view: {
      region: { x: 0, y: 0, width: 4032, height: 3024 },
      quarter_turns: 0,
      straighten_millidegrees: 0,
    },
    marks: [{ kind: 'arrow', geometry: { from: { x: 2000, y: 9000 }, to: { x: 4200, y: 5800 } } }],
    caption: 'The whole board',
    why: 'Where the chip sits, for scale.',
    state: 'ready',
  }),
]
