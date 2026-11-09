import { useState } from 'react'
import type { CaptureWorkspaceProps } from '#/capture/types'
import type { InventoryModelDto } from '@invimport/contracts'
import { Small, Button } from '#/components/ui'
import { Input, Label, Select } from '#/forms'

export function MappingReader({ observe }: Pick<CaptureWorkspaceProps, 'observe'>) {
  const [model, setModel] = useState<InventoryModelDto>('category')
  const [pk, setPk] = useState('')
  return (
    <>
      <Label>
        Read existing mapping type
        <Select
          value={model}
          onChange={(event) => setModel(event.target.value as InventoryModelDto)}
        >
          <option value="category">Category</option>
          <option value="parameter_template">Parameter template</option>
          <option value="category_parameter">Category parameter mapping</option>
          <option value="company">Company</option>
        </Select>
      </Label>
      <Label>
        Mapping record ID
        <Input value={pk} inputMode="numeric" onChange={(event) => setPk(event.target.value)} />
      </Label>
      <Button type="button" onClick={() => void observe(model, pk)}>
        Read mapped record
      </Button>
      <Small>
        Read an existing record, inspect it, then select it below. No category, template or company
        is created.
      </Small>
    </>
  )
}
