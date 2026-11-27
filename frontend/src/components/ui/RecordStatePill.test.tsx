import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { RecordStatePill } from './RecordStatePill'

it('gives each record state one tone and glyph on every screen', () => {
  render(
    <>
      <RecordStatePill state="new">New</RecordStatePill>
      <RecordStatePill state="update">Update</RecordStatePill>
      <RecordStatePill state="exists">Exists</RecordStatePill>
      <RecordStatePill state="choose">Choose</RecordStatePill>
    </>,
  )

  const tone = (word: string) => screen.getByText(word).closest('[data-tone]')

  expect(tone('New')).toHaveAttribute('data-tone', 'info')
  expect(tone('Update')).toHaveAttribute('data-tone', 'acc')
  expect(tone('Exists')).toHaveAttribute('data-tone', 'ok')
  expect(tone('Choose')).toHaveAttribute('data-tone', 'warn')
})
