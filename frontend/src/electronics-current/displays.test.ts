import { Mesh, MeshBasicMaterial, SpriteMaterial } from 'three'
import { expect, test } from 'vitest'
import type { DisplayState } from './part-model'
import {
  DISPLAY_MESSAGE,
  FOURTEEN_SEGMENT_FONT,
  NIXIE_FONT,
  SEVEN_SEGMENT_FONT,
  charactersAt,
  updateDisplay,
} from './parts/displays'

test('every character the displays can show has a glyph', () => {
  for (const character of DISPLAY_MESSAGE) {
    expect(FOURTEEN_SEGMENT_FONT[character], character).toBeDefined()
  }

  for (let step = 0; step < 220; step++) {
    charactersAt('count', step).forEach((digit) =>
      expect(FOURTEEN_SEGMENT_FONT[digit]).toBeDefined(),
    )
    charactersAt('seven', step).forEach((digit) => expect(SEVEN_SEGMENT_FONT[digit]).toBeDefined())
  }
})

test('text scrolls through the message, counters wrap at their range', () => {
  expect(charactersAt('text', 0)).toEqual(['B', 'E'])
  expect(charactersAt('text', DISPLAY_MESSAGE.length - 1)).toEqual([' ', 'B'])
  expect(charactersAt('count', 2 * 99)).toEqual(['9', '9'])
  expect(charactersAt('count', 2 * 100)).toEqual(['0', '0'])
  expect(charactersAt('seven', 2 * 10)).toEqual(['0'])
  expect(charactersAt('text', -1)).toEqual([' ', 'B'])
})

test('updating a display lights exactly the glyph segments and skips unchanged steps', () => {
  const lit = new MeshBasicMaterial()
  const unlit = new MeshBasicMaterial()
  const segments = new Map(
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].map((name) => [name, new Mesh(undefined, unlit)]),
  )
  const display: DisplayState = {
    digits: [segments],
    materials: { lit, unlit, glow: new SpriteMaterial() },
    mode: 'seven',
    step: null,
  }

  updateDisplay(display, 0, 0)
  const litNames = [...segments].filter(([, mesh]) => mesh.material === lit).map(([name]) => name)
  expect(litNames.sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])

  const firstStep = display.step
  segments.forEach((mesh) => {
    mesh.material = unlit
  })
  updateDisplay(display, 0.1, 0)
  expect(display.step).toBe(firstStep)
  expect([...segments.values()].every((mesh) => mesh.material === unlit)).toBe(true)
})

test('every Nixie count has a numeral', () => {
  for (let step = 0; step < 40; step++) {
    charactersAt('nixie', step).forEach((digit) => expect(NIXIE_FONT[digit]).toBe(`n${digit}`))
  }
})

test('a Nixie lights and thickens exactly the current numeral', () => {
  const lit = new MeshBasicMaterial()
  const unlit = new MeshBasicMaterial()
  const names = Array.from({ length: 10 }, (_, digit) => `n${digit}`)
  const numerals = new Map(names.map((name) => [name, new Mesh(undefined, unlit)]))
  const thick = new Map(
    names.map((name) => {
      const mesh = new Mesh()
      mesh.visible = false

      return [name, mesh]
    }),
  )
  const display: DisplayState = {
    digits: [numerals],
    emphasis: [thick],
    materials: { lit, unlit, glow: new SpriteMaterial() },
    mode: 'nixie',
    step: null,
  }

  for (const time of [0, 0.9, 1.8, 2.7]) {
    updateDisplay(display, time, 0)
    const shown = `n${charactersAt('nixie', display.step ?? 0)[0]}`
    const litNames = names.filter((name) => numerals.get(name)?.material === lit)
    const thickNames = names.filter((name) => thick.get(name)?.visible)

    expect(litNames).toEqual([shown])
    expect(thickNames).toEqual([shown])
  }
})
