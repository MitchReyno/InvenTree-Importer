import { canonical } from '@invimport/contracts/json'
import { sha256 } from '../../db/authority.ts'

/** An explicit fake profile is not a compatibility claim for an InvenTree deployment. */
export const SUPPORTED_EFFECTS_MANIFEST = Object.freeze({
  version: 'bench-effects-capability/1',
  build: 'bench-effects/1',
  capability: 'owned-fake-effects/1',
  qualification: 'owned_fake_only',
  sourceVersion: 'InvenTree/1.5.0',
  createPart: true,
  mappedCategory: true,
  mappedParameters: true,
  manufacturerPart: true,
  supplierPart: true,
  stock: true,
  partAttachment: true,
  stockAttachment: true,
  tags: 'new_part_create_only',
  tagCreation: true,
  primaryImageReplacement: false,
  categoryTemplateCompanyCreation: false,
  arbitraryOverwrite: false,
})

/** Adds supervised creation of new locations and supplier companies; `/1` stays byte-for-byte. */
export const RECORD_EFFECTS_MANIFEST = Object.freeze({
  ...SUPPORTED_EFFECTS_MANIFEST,
  version: 'bench-effects-capability/2',
  build: 'bench-effects/2',
  capability: 'owned-fake-effects/2',
  createLocation: true,
  recursiveLocationCreation: false,
  createSupplierCompany: true,
  companyImageOnCreate: true,
})

export function effectsManifestDigestFor(version: 'bench-effects-plan/1' | 'bench-effects-plan/2') {
  return sha256(
    canonical(
      version === 'bench-effects-plan/1' ? SUPPORTED_EFFECTS_MANIFEST : RECORD_EFFECTS_MANIFEST,
    ),
  ).toString('hex')
}
