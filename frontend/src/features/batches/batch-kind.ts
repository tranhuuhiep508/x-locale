/** Batches the review/translate/publish workspace can open (mirrors the backend allowlist). */
const WORKSPACE_BATCH_KINDS = new Set(['cli_push', 'import', 'excel_import'])

export function opensBatchWorkspace(batchKind: string | null | undefined): boolean {
  return Boolean(batchKind && WORKSPACE_BATCH_KINDS.has(batchKind))
}

/** Short noun for a workspace batch, e.g. "CLI push" or "Excel import". */
export function batchKindName(batchKind: string | null | undefined): string {
  if (batchKind === 'import') return 'Import'
  if (batchKind === 'excel_import') return 'Excel import'
  return 'CLI push'
}
