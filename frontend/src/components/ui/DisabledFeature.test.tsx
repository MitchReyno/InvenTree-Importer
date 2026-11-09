import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DisabledFeature } from './DisabledFeature'
import { NumberStepper } from './NumberStepper'

const explanation = 'Automatic logo discovery is coming soon. Upload a logo manually for now.'

/** Every control's handler stands in for a request: none may run. */
function setup(control: 'checkbox' | 'select' | 'stepper' | 'text' | 'button') {
  const send = vi.fn()
  const user = userEvent.setup()
  render(
    <form onSubmit={send}>
      <DisabledFeature explanation={explanation}>
        {(disabled) => {
          switch (control) {
            case 'checkbox':
              return (
                <label>
                  <input type="checkbox" onChange={send} {...disabled} />
                  Find automatically
                </label>
              )
            case 'select':
              return (
                <label>
                  Model
                  <select defaultValue="a" onChange={send} {...disabled}>
                    <option value="a">Default</option>
                    <option value="b">Larger</option>
                  </select>
                </label>
              )
            case 'stepper':
              return (
                <NumberStepper
                  label="Sessions at once"
                  value={3}
                  min={1}
                  max={8}
                  onChange={send}
                  {...disabled}
                />
              )
            case 'text':
              return (
                <label>
                  Import reference prefix
                  <input type="text" defaultValue="" onChange={send} {...disabled} />
                </label>
              )
            case 'button':
              return (
                <button type="submit" onClick={send} {...disabled}>
                  Check now
                </button>
              )
          }
        }}
      </DisabledFeature>
    </form>,
  )
  return { send, user }
}

async function pressEverything(user: ReturnType<typeof userEvent.setup>, target: HTMLElement) {
  await user.click(target)
  target.focus()
  await user.keyboard('{Enter}')
  await user.keyboard(' ')
  await user.keyboard('{ArrowDown}')
  await user.keyboard('abc')
}

describe('DisabledFeature', () => {
  it.each([
    ['checkbox', () => screen.getByRole('checkbox', { name: 'Find automatically' })],
    ['select', () => screen.getByRole('combobox', { name: 'Model' })],
    ['text', () => screen.getByRole('textbox', { name: 'Import reference prefix' })],
    ['button', () => screen.getByRole('button', { name: 'Check now' })],
  ] as const)('a %s takes focus, explains itself and ignores input', async (control, find) => {
    const { send, user } = setup(control)
    const target = find()

    expect(target).toHaveAttribute('aria-disabled', 'true')
    expect(target).not.toBeDisabled()
    expect(target).toHaveAccessibleDescription(explanation)
    await user.tab()
    expect(target).toHaveFocus()

    await pressEverything(user, target)
    expect(send).not.toHaveBeenCalled()
    if (control === 'checkbox') {
      expect(target).not.toBeChecked()
    }
    if (control === 'select') {
      expect(target).toHaveValue('a')
    }
    if (control === 'text') {
      expect(target).toHaveValue('')
    }
  })

  it('a stepper takes focus and ignores both buttons', async () => {
    const { send, user } = setup('stepper')
    const more = screen.getByRole('button', { name: 'One more' })
    const fewer = screen.getByRole('button', { name: 'One fewer' })

    for (const button of [fewer, more]) {
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toHaveAccessibleDescription(explanation)
    }
    await user.tab()
    expect(fewer).toHaveFocus()
    await pressEverything(user, more)
    await pressEverything(user, fewer)
    expect(send).not.toHaveBeenCalled()
  })

  it('keeps the visible "Coming later" eyebrow and prints the explanation inline', () => {
    setup('checkbox')
    const checkbox = screen.getByRole('checkbox', { name: 'Find automatically' })
    const box = checkbox.closest('[data-disabled-feature]')

    expect(box).toHaveTextContent(`Find automaticallyComing later${explanation}`)
    expect(screen.getByText(explanation)).toBeVisible()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
