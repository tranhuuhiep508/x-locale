import type { ImportDiffItem, ImportResult } from '@/lib/api/types'

export type PasteKind = 'create' | 'update' | 'noop'

export type PastePreviewCounts = {
  create: number
  update: number
  noop: number
}

export type PastePreview = {
  create: string[]
  update: string[]
  noop: string[]
  counts: PastePreviewCounts
}

export const PASTE_KIND_ORDER: PasteKind[] = ['create', 'update', 'noop']

export const PASTE_SECTION_LABEL: Record<PasteKind, string> = {
  create: 'Create',
  update: 'Update',
  noop: 'No-op',
}

function compactKeys(full: string[] | undefined, sampled: ImportDiffItem[] | undefined): string[] {
  if (full) return full
  return (sampled ?? []).map((item) => item.key)
}

export function buildPastePreview(result: ImportResult | null): PastePreview {
  const diff = result?.diff
  return {
    create: compactKeys(diff?.keys?.create, diff?.create),
    update: compactKeys(diff?.keys?.update, diff?.update),
    noop: compactKeys(diff?.keys?.noop, undefined),
    counts: {
      create: diff?.create_count ?? 0,
      update: diff?.update_count ?? 0,
      noop: diff?.noop_count ?? 0,
    },
  }
}

export function pasteCountLabel(counts: PastePreviewCounts): string {
  const parts: string[] = []
  if (counts.create) parts.push(`${counts.create} create`)
  if (counts.update) parts.push(`${counts.update} update`)
  if (counts.noop) parts.push(`${counts.noop} no-op`)
  return parts.join(' · ')
}

export function hasPasteWrites(preview: PastePreview): boolean {
  return preview.counts.create + preview.counts.update > 0
}

export function keysForKind(preview: PastePreview, kind: PasteKind): string[] {
  if (kind === 'create') return preview.create
  if (kind === 'update') return preview.update
  return preview.noop
}

export function filterKeys(keys: string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return keys
  return keys.filter((key) => key.toLowerCase().includes(q))
}
