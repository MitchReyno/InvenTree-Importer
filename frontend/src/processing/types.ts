import type { BatchActivityDto, AgentSettingsDto } from '@invimport/contracts'
import type { SessionListRead } from '#/agents/session-list'
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
  SessionHistoryBriefDto,
  SessionHistoryDto,
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
  /** Session profiles only: the newest recorded actions across the batch's sessions. */
  batchActivity?(batchId: string, limit?: number): Promise<BatchActivityDto>
  /** Session profiles only: the newest page of a session's history, or the page before `before`. */
  history?(batchId: string, jobId: string, before?: string): Promise<SessionHistoryDto>
  /** Session profiles only: the brief a `/7` attempt of a session started from. */
  brief?(batchId: string, jobId: string, attemptId: string): Promise<SessionHistoryBriefDto>
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
  sessions: SessionListRead
  settings: () => Promise<AgentSettingsDto>
  /** Pauses or resumes the batch's sessions; absent where this setup cannot. */
  pause?: (batchId: string, paused: boolean) => Promise<unknown>
  /** Sends the batch's saved instructions to its sessions. */
  deliverInstructions?: (batchId: string) => Promise<{ sessions: number; woken: number }>
}
