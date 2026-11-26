import { unicodeText } from './unicode-text.ts'

/** The agent steps that take their own instructions; Inventory has none. */
export const AGENT_INSTRUCTION_STAGES = ['examine', 'research', 'images'] as const
export type AgentInstructionStage = (typeof AGENT_INSTRUCTION_STAGES)[number]

/** The most characters (code points) one step's instructions may hold. */
export const STEP_INSTRUCTIONS_MAX_CHARACTERS = 1000

/** A step's instructions as a session input or brief seals them, counted in code points. */
export const StepInstructionsText = unicodeText(1, STEP_INSTRUCTIONS_MAX_CHARACTERS)
