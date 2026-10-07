import {
  ReviewDialogBody,
  ReviewDialogContent,
  ReviewDialogFooter,
  ReviewDialogHeader,
} from '@/components/layout/ReviewDialog'
import type { ImportDiffItem, ImportResult } from '@/lib/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'

function SampleList({
  label,
  prefix,
  items,
  total,
}: {
  label: string
  prefix: string
  items: ImportDiffItem[]
  total: number
}) {
  if (total === 0) return null
  return (
    <section className="min-w-0" aria-label={label}>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{label}</h3>
        <Badge variant="secondary" className="font-mono text-[11px]">{total}</Badge>
      </div>
      <ul className="flex max-h-44 flex-col divide-y divide-border/60 overflow-y-auto rounded-xl border border-border/80 bg-card shadow-2xs">
        {items.map((item) => (
          <li key={item.key} className="flex min-w-0 flex-col gap-1 px-3.5 py-2.5">
            <code className="font-mono text-xs break-all font-medium text-foreground/90" translate="no">
              {prefix} {item.key}
            </code>
            <p className="text-xs whitespace-pre-wrap wrap-anywhere text-muted-foreground">
              {item.source_text || 'empty'}
            </p>
          </li>
        ))}
        {total > items.length ? (
          <li className="px-3.5 py-2 text-xs text-muted-foreground bg-muted/20">
            and {total - items.length} more…
          </li>
        ) : null}
      </ul>
    </section>
  )
}

export function ImportPreviewSummary({ result }: { result: ImportResult | null }) {
  const diff = result?.diff
  if (!diff) return null
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="grid grid-cols-3 gap-2.5 text-center tabular-nums">
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3.5">
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{diff.create_count}</p>
          <p className="text-xs text-muted-foreground font-medium mt-0.5">New strings</p>
        </div>
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5">
          <p className="text-2xl font-bold text-primary">{diff.update_count}</p>
          <p className="text-xs text-muted-foreground font-medium mt-0.5">Updated</p>
        </div>
        <div className="rounded-xl border border-border/80 bg-muted/30 p-3.5">
          <p className="text-2xl font-bold text-foreground/80">{diff.orphan_count}</p>
          <p className="text-xs text-muted-foreground font-medium mt-0.5">Orphaned</p>
        </div>
      </div>
      <SampleList label="New keys:" prefix="+" items={diff.create} total={diff.create_count} />
      <SampleList label="Updated keys:" prefix="~" items={diff.update} total={diff.update_count} />
      {diff.orphan_count > 0 ? (
        <SampleList
          label="Orphaned keys:"
          prefix="–"
          items={diff.orphan}
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel()
      }}
    >
      <ReviewDialogContent className="sm:max-w-lg">
        <ReviewDialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </ReviewDialogHeader>
        <ReviewDialogBody>
          <ImportPreviewSummary result={result} />
        </ReviewDialogBody>
        <ReviewDialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onApply} disabled={!canApply}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {applyLabel}
          </Button>
        </ReviewDialogFooter>
      </ReviewDialogContent>
    </Dialog>
  )
}
