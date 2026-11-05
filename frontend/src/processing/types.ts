import type {
  ProcessingAnswerDto,
  ProcessingAnswerReceiptDto,
  ProcessingCancellationDto,
  ProcessingReceiptDto,
  ProcessingSnapshotDto,
  ProcessingStartDto,
  SessionInboxReceiptDto,
  SessionInboxSubmissionDto,
  SessionTimelineDto,
} from '@invimport/contracts'

export interface ProcessingClient {
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
