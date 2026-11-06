/** Chip copy for a catalog opened from an activity batch. */
export function batchFilterChipLabel(batchKind: string | undefined): string {
  if (batchKind === 'excel_import') return 'Filtered to this Excel import'
  if (batchKind === 'translate') return 'Filtered to this translation'
  return 'Filtered to this push'
}

export function catalogEmptyCopy(batchFiltered: boolean, hasOtherFilters: boolean): {
  title: string
  description: string
} {
  if (batchFiltered) {
    return {
      title: 'No strings left for this batch',
      description: 'Clear the batch filter to see the live catalog.',
    }
  }
  if (hasOtherFilters) {
    return {
      title: 'No strings found',
      description: 'Try adjusting your filters.',
    }
  }
  return {
    title: 'No strings found',
    description: 'Add your first string to get started.',
  }
}
