export interface EvidenceSelection {
  evidenceId: string
  versionId: string
  page: number
  previewId: string
}

/** Partial or malformed links stay explicit and unavailable; they never select a default. */
export function evidenceFromHash(hash: string): EvidenceSelection | null | undefined {
  const params = new URLSearchParams(hash.split('?')[1] ?? '')
  const names = ['source', 'version', 'page', 'preview']
  if (!names.some((name) => params.has(name))) {
    return undefined
  }
  const source = params.get('source')
  const version = params.get('version')
  const preview = params.get('preview')
  const page = params.get('page') ?? ''
  const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (
    !source ||
    !version ||
    !preview ||
    !id.test(source) ||
    !id.test(version) ||
    !id.test(preview) ||
    !/^[1-9][0-9]{0,5}$/.test(page) ||
    names.some((name) => params.getAll(name).length !== 1)
  ) {
    return null
  }
  return { evidenceId: source, versionId: version, page: Number(page), previewId: preview }
}

export function withEvidence(hash: string, selection: EvidenceSelection | undefined): string {
  const [path, query = ''] = hash.split('?')
  const params = new URLSearchParams(query)
  for (const name of ['source', 'version', 'page', 'preview']) {
    params.delete(name)
  }
  if (selection) {
    params.set('source', selection.evidenceId)
    params.set('version', selection.versionId)
    params.set('page', String(selection.page))
    params.set('preview', selection.previewId)
  }
  const encoded = params.toString()
  return `${path}${encoded ? `?${encoded}` : ''}`
}

/** Mode/filter navigation preserves even an invalid pinned link until explicit selection. */
export function retainEvidenceQuery(hash: string, previous: string): string {
  const [path, query = ''] = hash.split('?')
  const params = new URLSearchParams(query)
  const retained = new URLSearchParams(previous.split('?')[1] ?? '')
  for (const name of ['source', 'version', 'page', 'preview']) {
    for (const value of retained.getAll(name)) {
      params.append(name, value)
    }
  }
  const encoded = params.toString()
  return `${path}${encoded ? `?${encoded}` : ''}`
}
