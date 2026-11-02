import type {
  ApprovalDto,
  ManualAcceptedDto,
  ManualActivityDto,
  ManualPreparationResultDto,
  ManualRecoveryCommandDto,
  ManualReviewResultDto,
  ManualRunCommandDto,
  ManualRunDto,
  ManualScopeDto,
  ManualWorkspaceDto,
} from '@invimport/contracts'

/** Browser domain port; generated wire clients satisfy these runtime-schema DTOs. */
export interface ManualClient {
  activity: () => Promise<ManualActivityDto>
  workspace: (batchId: string) => Promise<ManualWorkspaceDto>
  review: (batchId: string, input: ManualScopeDto, key: string) => Promise<ManualReviewResultDto>
  prepare: (
    batchId: string,
    input: ManualScopeDto,
    key: string,
  ) => Promise<ManualPreparationResultDto>
  approve: (input: ApprovalDto, key: string) => Promise<ManualAcceptedDto>
  run: (runId: string) => Promise<ManualRunDto>
  start: (runId: string, input: ManualRunCommandDto, key: string) => Promise<ManualAcceptedDto>
  cancel: (runId: string, input: ManualRunCommandDto, key: string) => Promise<ManualAcceptedDto>
  recover: (
    runId: string,
    input: ManualRecoveryCommandDto,
    key: string,
  ) => Promise<ManualAcceptedDto>
}

export type ManualStage = 'capture' | 'review' | 'approve' | 'results'

export type RunRecoverySelection = {
  kind: 'stock' | 'attachment' | 'effect' | 'assessment'
  keys: string[]
}
