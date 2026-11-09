import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DisabledFeature } from './DisabledFeature'
import { NumberStepper } from './NumberStepper'

const explanation = 'Automatic logo discovery is coming soon. Upload a logo manually for now.'

/** Every control's handler stands in for a request: none may run. */
function setup(control: 'checkbox' | 'select' | 'stepper' | 'text' | 'number' | 'button') {
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
                  <select defaultValue="a" onChange={send} onKeyDown={send} {...disabled}>
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
                  <input
                    type="text"
                    defaultValue=""
                    onChange={send}
                    onKeyDown={(event) => {
                      if (event.ctrlKey && event.key === 'z') {
                        send()
                      }
                    }}
                    {...disabled}
                  />
                </label>
              )
            case 'number':
              return (
                <label>
                  Sessions
                  <input
                    type="number"
                    defaultValue="3"
                    onChange={send}
                    onKeyDown={send}
                    {...disabled}
                  />
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
  expect(target).toHaveFocus()
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
      await user.keyboard('{ArrowRight}{Home}{End}{F4}')
      expect(target).toHaveValue('a')
      expect(send).not.toHaveBeenCalled()
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

  it('lets app shortcuts through but refuses editing chords', async () => {
    const shortcut = vi.fn()
    const { send, user } = setup('text')
    document.addEventListener('keydown', shortcut)
    const field = screen.getByRole('textbox', { name: 'Import reference prefix' })
    await user.click(field)

    await user.keyboard('{Control>}k{/Control}')
    expect(shortcut).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'k', defaultPrevented: false }),
    )
    await user.keyboard('{Control>}z{/Control}{Control>}{Backspace}{/Control}')
    expect(send).not.toHaveBeenCalled()
    expect(field).toHaveFocus()
    document.removeEventListener('keydown', shortcut)
  })

  it('a number field ignores the arrow keys that would step it', async () => {
    const { send, user } = setup('number')
    const field = screen.getByRole('spinbutton', { name: 'Sessions' })
    await user.click(field)

    await user.keyboard('{ArrowUp}{ArrowDown}{Home}')
    expect(field).toHaveValue(3)
    expect(send).not.toHaveBeenCalled()
  })

  it('single-key app shortcuts pass a focused button, but Space and Enter do not', async () => {
    const shortcut = vi.fn()
    const { send, user } = setup('button')
    document.addEventListener('keydown', shortcut)
    await user.click(screen.getByRole('button', { name: 'Check now' }))

    await user.keyboard('j')
    expect(shortcut).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'j', defaultPrevented: false }),
    )
    shortcut.mockClear()
    await user.keyboard('{Enter} ')
    expect(shortcut).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    document.removeEventListener('keydown', shortcut)
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
