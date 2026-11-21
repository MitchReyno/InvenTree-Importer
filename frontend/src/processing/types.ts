import type { AgentSessionListDto, AgentSettingsDto } from '@invimport/contracts'
import type {
  SessionFailureDto,
  ProcessingAnswerDto,
  ProcessingAnswerReceiptDto,
  ProcessingCancellationDto,
  ProcessingReceiptDto,
  ProcessingSnapshotDto,
  ProcessingStartDto,
  SessionInboxReceiptDto,
  SessionInboxSubmissionDto,
  SessionTimelineDto,
  SessionReplacementDto,
} from '@invimport/contracts'

export interface ProcessingClient {
  failure?(attemptId: string, failureId: string): Promise<SessionFailureDto>
  read(batchId: string): Promise<ProcessingSnapshotDto>
  start(batchId: string, input: ProcessingStartDto, key: string): Promise<ProcessingReceiptDto>
  cancel(
    batchId: string,
    jobId: string,
    input: ProcessingCancellationDto,
    key: string,
  ): Promise<ProcessingReceiptDto>
  answer(
    batchId: string,
    questionId: string,
    input: ProcessingAnswerDto,
    key: string,
  ): Promise<ProcessingAnswerReceiptDto>
  replaceSession?(
    batchId: string,
    jobId: string,
    input: SessionReplacementDto,
    key: string,
  ): Promise<ProcessingReceiptDto>
  /** Session profiles only. */
  session?(batchId: string, jobId: string): Promise<SessionTimelineDto>
  chat?(
    batchId: string,
    jobId: string,
    input: SessionInboxSubmissionDto,
    key: string,
  ): Promise<SessionInboxReceiptDto>
}
/** The Processing steps; Examine shows the Reading and Identifying stages. */
export type ProcessingView = 'overview' | 'examine' | 'research' | 'images' | 'inventory'

/** The agent-session read Processing shares with the Agents page, for start times and the slot limit. */
export type AgentsRead = {
  sessions: (before?: string) => Promise<AgentSessionListDto>
  settings: () => Promise<AgentSettingsDto>
  /** Pauses or resumes the batch's sessions; absent where this setup cannot. */
  pause?: (batchId: string, paused: boolean) => Promise<unknown>
  /** Sends the batch's saved instructions to its sessions. */
  deliverInstructions?: (batchId: string) => Promise<{ sessions: number; woken: number }>
}
