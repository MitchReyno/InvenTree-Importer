import type {
  BulkEditDto,
  BulkEditResultDto,
  InstructionEditDto,
  IssueDispositionDto,
  OperatorReviewDto,
  RestructureDto,
  RestructureResultDto,
} from '@invimport/contracts'

/** Browser port for operator review; the generated `operatorReviewClient` satisfies it. */
export interface OperatorReviewClient {
  read: (batchId: string) => Promise<OperatorReviewDto>
  dismiss: (batchId: string, input: IssueDispositionDto, key: string) => Promise<OperatorReviewDto>
  bulkEdit: (batchId: string, input: BulkEditDto, key: string) => Promise<BulkEditResultDto>
  restructure: (
    batchId: string,
    input: RestructureDto,
    key: string,
  ) => Promise<RestructureResultDto>
  instruct: (batchId: string, input: InstructionEditDto, key: string) => Promise<OperatorReviewDto>
}
