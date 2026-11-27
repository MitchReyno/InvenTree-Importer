import { nativeInstructions, nativeInstructionDigest } from '#/agents/policy.ts'
import { sha256 } from '#/db/authority.ts'

export const instructionVersion = 'restricted-synthetic/1'
export const toolProfileVersion = 'restricted-no-tools/1'
export const trustedInstructions =
  'Synthetic fixture only. Read staged manual evidence. Emit bounded proposals or application questions. Do not select human values, approve effects, access inventory writes or replay native permission handles.'
export const instructionDigest = sha256(trustedInstructions).toString('hex')

export const mediaInstructionVersion = 'restricted-synthetic/2'
export const mediaTrustedInstructions =
  'Deterministic synthetic fixture only. Read staged notes and exact media descriptors as metadata. Do not claim media content inspection or actual model inference. Emit bounded source-bound proposals or application questions. Do not select human values, approve effects, access media bytes, provider credentials, inventory writes or native permission handles.'
export const mediaInstructionDigest = sha256(mediaTrustedInstructions).toString('hex')

export const researchInstructionVersion = 'restricted-research-stub/1'
export const researchToolProfileVersion = 'restricted-research-tools/1'
export const researchTrustedInstructions =
  'Deterministic restricted research protocol stub only. Read exact staged evidence through the bounded semantic broker. Fetch only exact server-admitted source URLs and use only configured semantic inventory reads. Emit source-bound proposals or application questions. Do not invoke actual models, native providers, shell, filesystem, browser or raw MCP tools. Do not access credentials, select human values, approve or mutate inventory, or resume native permission handles.'
export const researchInstructionDigest = sha256(researchTrustedInstructions).toString('hex')

/** Old immutable instructions remain authority for retained /1 attempts only. */
export const processingProfiles = {
  'native-agent/1': {
    handlerVersion: 'processing/4',
    instructionVersion: 'native-agent/1',
    instructionDigest: nativeInstructionDigest,
    instructions: nativeInstructions,
    toolProfileVersion: 'native-no-tools/1',
    commandSchemaVersion: 'bench-intake-processing-command/4',
  },
  'synthetic-research/1': {
    handlerVersion: 'processing/1',
    instructionVersion,
    instructionDigest,
    instructions: trustedInstructions,
    toolProfileVersion,
    commandSchemaVersion: 'bench-intake-processing-command/1',
  },
  'synthetic-research/2': {
    handlerVersion: 'processing/2',
    instructionVersion: mediaInstructionVersion,
    instructionDigest: mediaInstructionDigest,
    instructions: mediaTrustedInstructions,
    toolProfileVersion,
    commandSchemaVersion: 'bench-intake-processing-command/2',
  },
  'restricted-research-stub/1': {
    handlerVersion: 'processing/3',
    instructionVersion: researchInstructionVersion,
    instructionDigest: researchInstructionDigest,
    instructions: researchTrustedInstructions,
    toolProfileVersion: researchToolProfileVersion,
    commandSchemaVersion: 'bench-intake-processing-command/3',
  },
} as const
