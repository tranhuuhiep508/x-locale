import { Link } from '@tanstack/react-router'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ImportResult } from '@/lib/api/types'
import type { BatchWorkspaceSearch } from '@/lib/schemas'
import { importReviewBatchId } from './import-continuation'

/**
 * After an import is saved as draft, offer to continue with exactly that batch:
 * review, optionally translate, then save or publish in the batch workspace.
 */
export function ImportContinuation({
  projectRef,
  result,
  batchKind = 'import',
  from,
  onNavigate,
}: {
  projectRef: string
  result: ImportResult
  batchKind?: 'import' | 'excel_import'
  from: NonNullable<BatchWorkspaceSearch['from']>
  onNavigate?: () => void
}) {
  const batchId = importReviewBatchId(result)
  return (
    <div role="status" className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/20 p-4">
      <div className="flex items-start gap-2.5">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div className="min-w-0 text-sm">
          <p className="font-medium">
            {batchId
              ? `Saved to the working copy: ${result.created} added · ${result.updated} updated`
              : 'Nothing changed'}
          </p>
          <p className="text-muted-foreground">
            {batchId
              ? 'Nothing is public yet. Review this batch to translate and publish it.'
              : 'Every imported value already matched the catalog.'}
          </p>
        </div>
      </div>
      {batchId ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" asChild>
            <Link
              to="/projects/$projectRef/batches/$batchId"
              params={{ projectRef, batchId }}
              search={{ from }}
              onClick={onNavigate}
            >
              Review &amp; publish batch
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link
              to="/projects/$projectRef/strings"
              params={{ projectRef }}
              search={{ batch_id: batchId, batch_kind: batchKind }}
              onClick={onNavigate}
            >
              View in Strings
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  )
}
