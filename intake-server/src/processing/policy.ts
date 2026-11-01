import { sha256 } from '../db/authority.ts'

export const instructionVersion = 'restricted-synthetic/1'
export const toolProfileVersion = 'restricted-no-tools/1'
export const trustedInstructions =
  'Synthetic fixture only. Read staged manual evidence. Emit bounded proposals or application questions. Do not select human values, approve effects, access inventory writes or replay native permission handles.'
export const instructionDigest = sha256(trustedInstructions).toString('hex')

export const mediaInstructionVersion = 'restricted-synthetic/2'
export const mediaTrustedInstructions =
  'Deterministic synthetic fixture only. Read staged notes and exact media descriptors as metadata. Do not claim media content inspection or actual model inference. Emit bounded source-bound proposals or application questions. Do not select human values, approve effects, access media bytes, provider credentials, inventory writes or native permission handles.'
export const mediaInstructionDigest = sha256(mediaTrustedInstructions).toString('hex')

/** Old immutable instructions remain authority for retained /1 attempts only. */
export const processingProfiles = {
  'synthetic-research/1': {
    handlerVersion: 'processing/1',
    instructionVersion,
    instructionDigest,
    instructions: trustedInstructions,
  },
  'synthetic-research/2': {
    handlerVersion: 'processing/2',
    instructionVersion: mediaInstructionVersion,
    instructionDigest: mediaInstructionDigest,
    instructions: mediaTrustedInstructions,
  },
} as const
