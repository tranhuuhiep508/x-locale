import type { ImportResult } from '@/lib/api/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'

const SAMPLE_LIMIT = 10

function SampleList({
  label,
  prefix,
  keys,
  total,
}: {
  label: string
  prefix: string
  keys: string[]
  total: number
}) {
  if (total === 0) return null
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex max-h-28 flex-col gap-0.5 overflow-y-auto">
        {keys.slice(0, SAMPLE_LIMIT).map((key) => (
          <code
            key={key}
            className="block rounded bg-muted px-2 py-0.5 text-xs text-foreground"
          >
            {prefix} {key}
          </code>
        ))}
        {total > SAMPLE_LIMIT ? (
          <p className="text-xs text-muted-foreground">and {total - SAMPLE_LIMIT} more…</p>
        ) : null}
      </div>
    </div>
  )
}

export function ImportPreviewSummary({ result }: { result: ImportResult | null }) {
  const diff = result?.diff
  if (!diff) return null
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-muted p-3">
          <p className="text-2xl font-bold text-foreground">{diff.create_count}</p>
          <p className="text-xs text-muted-foreground">New strings</p>
        </div>
        <div className="rounded-lg bg-muted p-3">
          <p className="text-2xl font-bold text-foreground">{diff.update_count}</p>
          <p className="text-xs text-muted-foreground">Updated</p>
        </div>
        <div className="rounded-lg bg-muted p-3">
          <p className="text-2xl font-bold text-foreground">{diff.orphan_count}</p>
          <p className="text-xs text-muted-foreground">Orphaned</p>
        </div>
      </div>
      <SampleList label="New keys:" prefix="+" keys={diff.create} total={diff.create_count} />
      <SampleList label="Updated keys:" prefix="~" keys={diff.update} total={diff.update_count} />
      {diff.orphan_count > 0 ? (
        <SampleList
          label="Orphaned keys:"
          prefix="–"
          keys={diff.orphan}
          total={diff.orphan_count}
        />
      ) : null}
    </div>
  )
}

export function hasImportWrites(result: ImportResult | null) {
  const diff = result?.diff
  if (!diff) return false
  return diff.create_count + diff.update_count > 0
}

export function ImportPreviewDialog({
  open,
  result,
  pending,
  title = 'Import preview (dry run)',
  description = 'Review changes before applying.',
  applyLabel = 'Apply import',
  applyDisabled = false,
  onCancel,
  onApply,
}: {
  open: boolean
  result: ImportResult | null
  pending: boolean
  title?: string
  description?: string
  applyLabel?: string
  applyDisabled?: boolean
  onCancel: () => void
  onApply: () => void
}) {
  const diff = result?.diff
  const canApply = Boolean(diff) && !applyDisabled && !pending

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !pending) onCancel() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ImportPreviewSummary result={result} />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onApply} disabled={!canApply}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {applyLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
