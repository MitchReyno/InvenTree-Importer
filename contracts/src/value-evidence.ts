import { Type, type Static } from '@sinclair/typebox'

/** Where a reading or proposed value was taken from, so its provenance reads in words. */
export const SourceKind = Type.Union(
  [
    Type.Literal('label'),
    Type.Literal('packing_slip'),
    Type.Literal('handwriting'),
    Type.Literal('distributor_page'),
  ],
  {
    description:
      'Where the value was read: a printed label, a packing slip, handwriting, or a distributor page.',
  },
)

/** How far the sources behind a value agree: read plainly, likely, or in conflict. */
export const SourceAgreement = Type.Union(
  [Type.Literal('read'), Type.Literal('likely'), Type.Literal('disagree')],
  {
    description:
      'read: stated plainly by its source; likely: inferred or partly legible; disagree: sources conflict.',
  },
)

/** Optional on every value, so readings and proposals retained before them stay valid. */
export const valueEvidence = {
  source_kind: Type.Optional(SourceKind),
  agreement: Type.Optional(SourceAgreement),
}

export type SourceKindDto = Static<typeof SourceKind>
export type SourceAgreementDto = Static<typeof SourceAgreement>
