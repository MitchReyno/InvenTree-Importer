import { describe, expect, it } from 'vitest'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { partFacts } from './part-facts'

const ref = (id: string, model: string) => ({
  observation_id: id,
  target_context_id: 't',
  model,
  pk: 1,
})

const batch = {
  observations: [
    { id: 'yageo', label: 'Yageo' },
    { id: 'mouser', label: 'Mouser' },
    { id: 'pkg', label: 'Package' },
    { id: 'dc', label: 'Date code' },
    { id: 'tol', label: 'Tolerance' },
  ],
} as unknown as CaptureSnapshotDto

const part = (spec: object) =>
  ({ id: 'p', label: 'Resistor', choice: { mode: 'create', spec } }) as never

describe('partFacts', () => {
  it('reads the maker, MPN, supplier SKU, package and date code from a new Part', () => {
    expect(
      partFacts(
        batch,
        part({
          manufacturer: { company: ref('yageo', 'company'), mpn: 'RC0603FR-0710KL' },
          supplier: { company: ref('mouser', 'company'), sku: '603-RC0603FR-0710KL' },
          parameters: [
            { template: ref('pkg', 'parameter_template'), value: '0603' },
            { template: ref('dc', 'parameter_template'), value: '2231' },
            { template: ref('tol', 'parameter_template'), value: '1%' },
          ],
        }),
      ),
    ).toEqual({
      manufacturer: 'Yageo',
      mpn: 'RC0603FR-0710KL',
      supplierSku: '603-RC0603FR-0710KL',
      package: '0603',
      dateCode: '2231',
    })
  })

  it('knows nothing of an existing or missing Part', () => {
    expect(partFacts(batch, undefined)).toEqual({})
    expect(partFacts(batch, { choice: { mode: 'unset' } } as never)).toEqual({})
  })
})
