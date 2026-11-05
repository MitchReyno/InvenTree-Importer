import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OptionRow } from './OptionRow'
import { QuestionCard } from './QuestionCard'

describe('QuestionCard', () => {
  it('asks the question as a legend, states why and the assumption in use', async () => {
    const onChange = vi.fn()
    render(
      <QuestionCard
        question="Is this 10kΩ or 100kΩ?"
        why="The label and the reel disagree."
        assumption="Using 10kΩ from the label until you answer."
        closeups={[{ label: 'Label', image: '/label.jpg' }]}
        answer={
          <OptionRow
            name="value"
            value={undefined}
            onChange={onChange}
            options={[
              { id: '10k', title: '10kΩ', detail: 'Matches the label' },
              { id: '100k', title: '100kΩ', detail: 'Matches the reel' },
            ]}
            escape={{
              id: 'unsure',
              title: 'Not sure',
              detail: 'Keep the assumption and flag the lot',
            }}
          />
        }
      />,
    )
    const group = screen.getByRole('group', { name: 'Is this 10kΩ or 100kΩ?' })

    expect(group).toHaveTextContent('The label and the reel disagree.')
    expect(group).toHaveTextContent('Using 10kΩ from the label until you answer.')
    expect(screen.getByRole('img', { name: 'Label' })).toHaveAttribute('src', '/label.jpg')
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    await userEvent.click(screen.getByRole('radio', { name: /100kΩ/ }))
    expect(onChange).toHaveBeenCalledWith('100k')
  })
})

describe('OptionRow', () => {
  it('always ends with the escape option and arrows move between radios', async () => {
    const onChange = vi.fn()
    render(
      <OptionRow
        name="mode"
        legend="Supplier"
        value="auto"
        onChange={onChange}
        options={[{ id: 'auto', title: 'Auto', detail: 'From the packet' }]}
        escape={{ id: 'none', title: 'None', detail: 'No supplier' }}
      />,
    )
    const radios = screen.getAllByRole('radio')

    expect(screen.getByRole('radiogroup', { name: 'Supplier' })).toBeInTheDocument()
    expect(radios[1]).toHaveAccessibleName('None No supplier')
    expect(radios[0]).toBeChecked()
    radios[0].focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(onChange).toHaveBeenCalledWith('none')
  })
})
