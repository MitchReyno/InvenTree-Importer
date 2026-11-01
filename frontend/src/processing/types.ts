import type {
  ProcessingAnswerDto,
  ProcessingAnswerReceiptDto,
  ProcessingCancellationDto,
  ProcessingReceiptDto,
  ProcessingSnapshotDto,
  ProcessingStartDto,
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
}
export type ProcessingView =
  'overview' | 'reading' | 'identifying' | 'research' | 'images' | 'inventory'
