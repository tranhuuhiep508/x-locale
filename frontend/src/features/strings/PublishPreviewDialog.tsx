import { CheckCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import {
  PUBLISH_KIND_ORDER,
  PUBLISH_SECTION_LABEL,
  hasPublishableChanges,
  previewCountLabel,
  rowsForKind,
  type PublishFieldChange,
  type PublishKind,
  type PublishPreview,
  type PublishPreviewRow,
} from '@/features/strings/publish-preview'
import { cn } from '@/lib/utils'

function displayText(value: string | null | undefined): string {
  const text = (value ?? '').trim()
  return text || 'empty'
}

function FieldDiff({ change }: { change: PublishFieldChange }) {
  const publishedEmpty = change.firstPublish || !(change.published ?? '').trim()
  return (
    <div className="grid gap-1 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:items-start">
      <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {change.label}
      </p>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-start gap-2">
          <span className="w-16 shrink-0 pt-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Published
          </span>
          <p
            className={cn(
              'min-w-0 text-sm wrap-break-word',
              publishedEmpty && 'italic text-muted-foreground',
              change.field === 'key' || change.field === 'module' ? 'font-mono text-xs break-all' : null,
            )}
          >
            {displayText(change.published)}
          </p>
          {change.firstPublish ? (
            <Badge variant="outline" className="shrink-0">
              First publish
            </Badge>
          ) : null}
        </div>
        <div className="flex min-w-0 items-start gap-2">
          <span className="w-16 shrink-0 pt-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Working
          </span>
          <p
            className={cn(
              'min-w-0 text-sm wrap-break-word',
              !(change.working ?? '').trim() && 'italic text-muted-foreground',
              change.field === 'key' || change.field === 'module' ? 'font-mono text-xs break-all' : null,
            )}
          >
            {displayText(change.working)}
          </p>
        </div>
      </div>
    </div>
  )
}

function WorkingOnlyFields({ fields }: { fields: PublishFieldChange[] }) {
  return (
    <div className="flex flex-col gap-2">
      {fields.map((change) => (
        <div key={change.field} className="grid gap-1 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
          <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            {change.label}
          </p>
          <p
            className={cn(
              'min-w-0 text-sm wrap-break-word',
              change.field === 'key' || change.field === 'module' ? 'font-mono text-xs break-all' : null,
            )}
          >
            {displayText(change.working)}
          </p>
        </div>
      ))}
    </div>
  )
}

function PreviewRow({ row }: { row: PublishPreviewRow }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border/80 bg-background/60 px-3 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-mono text-xs break-all" translate="no">
          {row.key}
        </span>
        {row.moduleSlug ? (
          <span className="font-mono text-[11px] text-muted-foreground">{row.moduleSlug}</span>
        ) : null}
        {row.kind === 'update' ? (
          <div className="flex flex-wrap gap-1">
            {row.fields.map((field) => (
              <Badge key={field.field} variant="secondary">
                {field.label}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">{row.summary}</span>
        )}
      </div>
      {row.kind === 'update' ? (
        <div className="flex flex-col gap-3 border-l-2 border-public-foreground/40 pl-3">
          {row.fields.map((change) => (
            <FieldDiff key={change.field} change={change} />
          ))}
        </div>
      ) : null}
      {row.kind === 'new' ? <WorkingOnlyFields fields={row.fields} /> : null}
    </li>
  )
}

function Section({
  kind,
  rows,
}: {
  kind: PublishKind
  rows: PublishPreviewRow[]
}) {
  if (rows.length === 0) return null
  return (
    <section className="flex flex-col gap-2" aria-label={PUBLISH_SECTION_LABEL[kind]}>
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {PUBLISH_SECTION_LABEL[kind]}
      </h3>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <PreviewRow key={row.id} row={row} />
        ))}
      </ul>
    </section>
  )
}

export function PublishPreviewDialog({
  open,
  preview,
  loading,
  confirming,
  onClose,
  onConfirm,
}: {
  open: boolean
  preview: PublishPreview | null
  loading?: boolean
  confirming?: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const busy = Boolean(loading || confirming)
  const ready = preview != null && !loading
  const publishable = ready && hasPublishableChanges(preview)
  const countLabel = preview ? previewCountLabel(preview.counts) : ''
  const description = !ready
    ? 'Comparing working copy to the last published snapshot…'
    : publishable
      ? countLabel
        ? `${countLabel}. Confirm publishes the working copy; Cancel leaves the catalog unchanged.`
        : 'Confirm publishes the working copy; Cancel leaves the catalog unchanged.'
      : 'Nothing in this set would change public.'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
    >
      <DialogContent className="flex max-h-[min(90dvh,840px)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <DialogTitle>Publish preview</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {loading || !preview ? (
            <div
              className="flex h-52 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
              aria-live="polite"
            >
              <Spinner />
              Loading publish changes…
            </div>
          ) : !publishable ? (
            <EmptyState
              title="Nothing to publish"
              description="These strings are already in sync, or are deleted and cannot be published."
            />
          ) : (
            <div className="flex flex-col gap-6">
              {PUBLISH_KIND_ORDER.map((kind) => (
                <Section key={kind} kind={kind} rows={rowsForKind(preview, kind)} />
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t bg-muted/40 px-5 py-3 sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!publishable || busy}>
            {confirming ? <Spinner data-icon="inline-start" /> : <CheckCircle data-icon="inline-start" />}
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
