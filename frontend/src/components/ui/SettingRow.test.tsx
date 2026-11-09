import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { SettingRow } from './SettingRow'
import { Switch } from './Switch'

test('a setting names its control group and describes it with its help', () => {
  render(
    <SettingRow label="Sessions at once" help="How many sessions may run turns together.">
      <input aria-label="Sessions" />
    </SettingRow>,
  )

  const row = screen.getByRole('group', { name: 'Sessions at once' })
  expect(row).toHaveAccessibleDescription('How many sessions may run turns together.')
  expect(row).toContainElement(screen.getByRole('textbox', { name: 'Sessions' }))
})

test('a deferred setting renders its control disabled with the reason', async () => {
  const onChange = vi.fn()
  const reason = 'Web research settings are not stored yet.'
  render(
    <SettingRow label="Web research" disabledReason={reason}>
      {({ disabled }) => (
        <Switch label="Allow public web pages" checked={false} onChange={onChange} {...disabled} />
      )}
    </SettingRow>,
  )
  const control = screen.getByRole('switch', { name: 'Allow public web pages' })

  expect(control).toHaveAttribute('aria-disabled', 'true')
  expect(control).toHaveAccessibleDescription(reason)
  await userEvent.click(control)
  expect(control).not.toBeChecked()
  expect(onChange).not.toHaveBeenCalled()
})

test('the row label names the control it is given', () => {
  render(
    <>
      <SettingRow label="Model">
        {({ named }) => (
          <select {...named}>
            <option>Default</option>
          </select>
        )}
      </SettingRow>
      <SettingRow label="Model per step" disabledReason="Not stored yet.">
        {({ named, disabled }) => (
          <select {...named} {...disabled}>
            <option>Same as the default</option>
          </select>
        )}
      </SettingRow>
    </>,
  )

  expect(screen.getByRole('combobox', { name: 'Model' })).toBeInTheDocument()
  const deferred = screen.getByRole('combobox', { name: 'Model per step' })
  expect(deferred).toHaveAttribute('aria-disabled', 'true')
  expect(deferred).toHaveAccessibleDescription('Not stored yet.')
})
