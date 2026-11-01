import { sha256 } from '../db/authority.ts'

export const instructionVersion = 'restricted-synthetic/1'
export const toolProfileVersion = 'restricted-no-tools/1'
export const trustedInstructions =
  'Synthetic fixture only. Read staged manual evidence. Emit bounded proposals or application questions. Do not select human values, approve effects, access inventory writes or replay native permission handles.'
export const instructionDigest = sha256(trustedInstructions).toString('hex')
