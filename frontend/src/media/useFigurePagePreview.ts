import type { QuestionFigureDto } from '@invimport/contracts'
import { useApiClients, useServerScope } from '#/context'
import { serverQueryKey } from '#/queries/scope'
import { useFreshRead } from '#/queries/useFreshRead'
import { previewImage, type ImageAttributes } from './images'

export type FigurePagePreview =
  | { state: 'loading' }
  | { state: 'ready'; image: ImageAttributes }
  /** No media read in this app, the read failed, or the page is gone from it. */
  | { state: 'unavailable' }

/** The page preview a question picture was cut from, from the batch's media read (shared with Capture's). */
export function useFigurePagePreview(
  batchId: string,
  source: QuestionFigureDto['source'],
): FigurePagePreview {
  const { media } = useApiClients()
  const scope = useServerScope()
  const read = useFreshRead({
    queryKey: serverQueryKey(scope, 'media', batchId),
    queryFn: () => {
      if (!media) {
        throw new Error('media_unavailable')
      }
      return media.snapshot(batchId)
    },
    enabled: media !== undefined,
  })
  const page = read.data?.evidence
    .find((evidence) => evidence.id === source.evidence_id)
    ?.versions.find((version) => version.id === source.version_id)
    ?.pages.find((candidate) => candidate.page === source.page)

  if (page) {
    return { state: 'ready', image: previewImage(batchId, page, 'viewer') }
  }
  if (media && read.query.isPending && read.query.fetchStatus === 'fetching') {
    return { state: 'loading' }
  }

  return { state: 'unavailable' }
}
