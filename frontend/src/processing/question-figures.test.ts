import { expect, test } from 'vitest'
import { figure } from '#/test/question-figures'
import {
  figureShownLine,
  figureSourceLine,
  figureStateText,
  markText,
  pageBadge,
} from './question-figures'

const straightened = figure(11, {
  view: {
    region: { x: 100, y: 100, width: 200, height: 120 },
    quarter_turns: 2,
    straighten_millidegrees: -2500,
  },
})

test('the source line says what the view did to its page, in order', () => {
  expect(figureSourceLine(straightened)).toBe(
    'IMG_3011 · cropped, turned upright, straightened, ×4',
  )
  expect(
    figureSourceLine(
      figure(3, {
        evidence_label: undefined,
        view: {
          region: { x: 0, y: 0, width: 4000, height: 3000 },
          quarter_turns: 0,
          straighten_millidegrees: 0,
        },
      }),
    ),
  ).toBe('A photo in this batch · the whole page')
})

test('the larger view names the region, the zoom, the turn and the angle', () => {
  expect(figureShownLine(straightened)).toBe(
    'Region 100, 100, 200 × 120 · ×4 · turned 180° · straightened 2.5°',
  )
})

test('marks read as words, a label quoted', () => {
  expect(
    markText({
      kind: 'circle',
      geometry: { x: 0, y: 0, width: 1000, height: 1000 },
      label: 'the 5',
    }),
  ).toBe('Circle: the 5')
  expect(
    markText({ kind: 'arrow', geometry: { from: { x: 0, y: 0 }, to: { x: 10000, y: 10000 } } }),
  ).toBe('Arrow')
  expect(markText({ kind: 'label', at: { x: 5000, y: 5000 }, label: 'Worn' })).toBe('Label: “Worn”')
})

test('a later document page is badged, and each unshown state says why', () => {
  expect(pageBadge(figure(1))).toBeUndefined()
  expect(pageBadge(figure(1, { source: { ...figure(1).source, page: 12 } }))).toBeUndefined()
  expect(pageBadge(figure(1, { document: true }))).toBe('p. 1')
  expect(pageBadge(figure(1, { source: { ...figure(1).source, page: 12 }, document: true }))).toBe(
    'p. 12',
  )
  expect(figureStateText('ready')).toBeUndefined()
  expect(figureStateText('preparing')).toBe('Preparing picture…')
  expect(figureStateText('failed')).toBe('Picture couldn’t be made')
  expect(figureStateText('removed')).toBe('Photo removed')
})
