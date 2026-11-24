import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { expect, test, vi } from 'vitest'
import { ModelPicker } from './ModelPicker'

type Props = Parameters<typeof ModelPicker>[0]

function picker(props: Partial<Props> = {}) {
  const onChange = vi.fn()
  render(
    <StrictMode>
      <ModelPicker
        label="Research model"
        providers={['claude', 'codex']}
        selectable={{ claude: true, codex: true }}
        value={null}
        fallback="Default · Claude opus"
        onChange={onChange}
        {...props}
      />
    </StrictMode>,
  )
  return {
    onChange,
    input: screen.getByRole('combobox', { name: props.label ?? 'Research model' }),
  }
}

const optionNames = () => screen.getAllByRole('option').map((option) => option.textContent)

test('lists Default, then each provider’s models grouped under its name', async () => {
  const user = userEvent.setup()
  const { input } = picker()
  await user.click(input)
  expect(optionNames()).toEqual([
    'Default · Claude opus',
    'Claude · sonnet',
    'Claude · opus',
    'Claude · haiku',
    'Codex · gpt-6.1-sol',
    'Codex · gpt-6.1-terra',
    'Codex · gpt-6-astra',
    'Codex · gpt-6-luna',
  ])
  expect(screen.getByText('Claude', { selector: 'div' })).toBeVisible()
  expect(screen.getByText('Codex', { selector: 'div' })).toBeVisible()
})

test('search by name or ID; picking a model picks its provider too', async () => {
  const user = userEvent.setup()
  const { input, onChange } = picker()
  await user.type(input, 'son')
  expect(optionNames()).toEqual([
    'Claude · sonnet',
    'Use “son” with Claude',
    'Use “son” with Codex',
  ])
  await user.click(screen.getByRole('option', { name: 'Claude · sonnet' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ provider: 'claude', model: 'sonnet' })
})

test('Default sets the step back to the default provider', async () => {
  const user = userEvent.setup()
  const { input, onChange } = picker({ value: { provider: 'codex', model: 'gpt-6-luna' } })
  expect(screen.getByText('Codex · gpt-6-luna')).toBeVisible()
  await user.click(input)
  await user.click(screen.getByRole('option', { name: 'Default · Claude opus' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
})

test('a provider that is off shows its models greyed with the reason, and they cannot be picked', async () => {
  const user = userEvent.setup()
  const { input, onChange } = picker({ selectable: { claude: true, codex: false } })
  await user.click(input)
  expect(screen.getByText('Codex · Turn Codex on to use its models')).toBeVisible()
  const luna = screen.getByRole('option', { name: 'Codex · gpt-6-luna' })
  expect(luna).toHaveAttribute('aria-disabled', 'true')
  await user.click(luna)
  expect(onChange).not.toHaveBeenCalled()
  await user.type(input, 'brand-new')
  // An exact ID is offered only for a provider that is on.
  expect(optionNames()).toEqual(['Use “brand-new” with Claude'])
})

test('an exact model ID is offered once per provider and checked as a model ID first', async () => {
  const user = userEvent.setup()
  const { input, onChange } = picker()
  await user.type(input, 'claude-next-5')
  await user.click(screen.getByRole('option', { name: 'Use “claude-next-5” with Claude' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ provider: 'claude', model: 'claude-next-5' })
  onChange.mockClear()
  await user.type(input, 'not a model!')
  const refused = screen.getByRole('option', { name: /“not a model!” isn’t a model ID/ })
  expect(refused).toHaveAttribute('aria-disabled', 'true')
  expect(screen.queryByRole('option', { name: /^Use “not a model!”/ })).not.toBeInTheDocument()
  await user.click(refused)
  expect(onChange).not.toHaveBeenCalled()
})

test('a listed model typed exactly is not offered again as an exact ID', async () => {
  const user = userEvent.setup()
  const { input } = picker()
  await user.type(input, 'opus')
  expect(optionNames()).toEqual(['Claude · opus'])
  await user.clear(input)
  await user.type(input, 'opus-5')
  expect(optionNames()).toEqual(['Use “opus-5” with Claude', 'Use “opus-5” with Codex'])
})

test('a provider’s own default model lists only its models, with no Default, and keeps a saved ID that isn’t listed', async () => {
  const user = userEvent.setup()
  const { input, onChange } = picker({
    label: 'Default model',
    providers: ['codex'],
    selectable: { claude: false, codex: true },
    fallback: undefined,
    value: { provider: 'codex', model: 'gpt-7-preview' },
  })
  expect(screen.getByText('gpt-7-preview')).toBeVisible()
  await user.click(input)
  expect(optionNames()).toEqual([
    'gpt-6.1-sol',
    'gpt-6.1-terra',
    'gpt-6-astra',
    'gpt-6-luna',
    'gpt-7-preview',
  ])
  await user.type(input, 'gpt-8')
  await user.click(screen.getByRole('option', { name: 'Use “gpt-8” with Codex' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ provider: 'codex', model: 'gpt-8' })
})
