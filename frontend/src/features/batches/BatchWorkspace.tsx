import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Check, Globe2, RotateCcw, Upload, Wand2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DataPagination } from '@/components/ui/data-pagination'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { PageBody, PageHeader } from '@/components/layout/PageHeader'
import { useQaWatch } from '@/features/strings/use-qa-watch'
import { QaLocaleBadge } from '@/features/strings/qa-issue-view'
import { ConfidenceBadge } from '@/features/strings/confidence'
import { contentFieldChanges } from '@/features/strings/publish-preview'
import { useBatchWorkspace } from '@/features/batches/use-batch-workspace'
import { BatchStepper } from '@/features/batches/BatchStepper'
import { formatRelativeTime } from '@/lib/utils'

export function BatchWorkspace({ projectRef, batchId }: { projectRef: string; batchId: string }) {
  const workspace = useBatchWorkspace(projectRef, batchId)
  const [page, setPage] = useState(1)
  const [restartOpen, setRestartOpen] = useState(false)
  const { query, project, busy, locales, preview } = workspace
  const batch = workspace.batch
  const publishable = preview.publishableIds.length
  const currentStep = workspace.published
    ? 3
    : workspace.publishing
      ? 2
      : workspace.hasDrafts
        ? 1
        : 0
  const reviewLocales = [
    ...new Set([
      ...locales,
      ...(batch?.items.flatMap((entry) => entry.translations.map((t) => t.locale)) ?? []),
    ]),
  ]
  const activePage = Math.min(page, Math.max(1, Math.ceil((batch?.items.length ?? 0) / 50)))
  const visible = batch?.items.slice((activePage - 1) * 50, activePage * 50) ?? []
  const missing =
    batch?.items.reduce(
      (n, entry) =>
        n +
        locales.filter(
          (locale) => !entry.translations.find((t) => t.locale === locale)?.value.trim()
        ).length,
      0
    ) ?? 0

  const qa = useQaWatch(
    projectRef,
    visible.flatMap((entry) =>
      reviewLocales.map((locale) => {
        const id = `${entry.id}:${locale}`
        const value = entry.translations.find((t) => t.locale === locale)?.value ?? ''
        return {
          id,
          locale,
          source: entry.source_text,
          text: value,
          baseline: workspace.qaBaselines[id] ?? {
            source: entry.source_text,
            text:
              query.data?.items
                .find((item) => item.id === entry.id)
                ?.translations.find((t) => t.locale === locale)?.value ?? '',
          },
        }
      })
    ),
    !busy
  )

  return (
    <PageBody className="gap-5">
      <div className="flex flex-col gap-2">
        <div>
          <Button variant="link" asChild>
            <Link to="/projects/$projectRef/activity" params={{ projectRef }} search={{}}>
              <ArrowLeft data-icon="inline-start" /> Activity
            </Link>
          </Button>
        </div>
        <PageHeader
          title="CLI push batch"
          description={
            batch
              ? `${batch.actor_label} · ${batch.created_at ? formatRelativeTime(batch.created_at) : 'CLI push'}`
              : 'Translate, review, and publish this push.'
          }
          actions={
            batch && (
              <Badge variant={workspace.published || !publishable ? 'secondary' : 'outline'}>
                {workspace.published
                  ? 'Published'
                  : publishable
                    ? 'Unpublished changes'
                    : 'In sync with public'}
              </Badge>
            )
          }
        />
      </div>
      {query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError ? (
        <EmptyState
          title="Batch unavailable"
          description={query.error.message}
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      ) : batch ? (
        <>
          <div className="overflow-hidden rounded-xl border bg-card shadow-2xs">
            <div className="px-3 py-5 sm:px-6">
              <BatchStepper current={currentStep} />
            </div>
            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-4 bg-muted/30 p-4 sm:px-5">
              <div className="flex min-w-0 flex-col gap-2">
                <h2 className="font-heading text-base font-semibold">
                  {batch.items.length} strings in this batch
                </h2>
                <p className="text-sm text-muted-foreground">
                  {batch.created_count} new · {batch.updated_count} updated · Source:{' '}
                  {project?.base_language.toUpperCase()}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Globe2 aria-hidden="true" className="size-3.5" />
                  <span>Project target languages</span>
                  {locales.map((locale) => (
                    <Badge key={locale} variant="outline">
                      {locale.toUpperCase()}
                    </Badge>
                  ))}
                  {!locales.length && <span>No target languages configured</span>}
                </div>
              </div>
              <Button
                onClick={() => void workspace.translate()}
                disabled={
                  busy ||
                  workspace.hasDrafts ||
                  workspace.stale ||
                  !locales.length ||
                  !batch.items.length
                }
              >
                {busy && !workspace.publishing ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Wand2 data-icon="inline-start" />
                )}
                Translate all
              </Button>
            </div>
          </div>
          {batch.excluded_count > 0 && (
            <p className="text-sm text-muted-foreground">
              {batch.excluded_count} deleted or pending-delete strings excluded. Manage them in
              Strings.
            </p>
          )}
          {workspace.error && (
            <Alert variant="destructive">
              <AlertTitle>Workflow could not complete</AlertTitle>
              <AlertDescription>{workspace.error}</AlertDescription>
            </Alert>
          )}
          {workspace.job.isError && (
            <Alert variant="destructive">
              <AlertTitle>Could not check translation progress</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3">
                <p>No results have been saved.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void workspace.job.refetch()}>
                    Retry status
                  </Button>
                  <Button variant="outline" onClick={workspace.stopJob}>
                    Stop tracking
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
          <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {busy ? (
              <div className="flex flex-wrap items-center gap-2">
                <Spinner /> {workspace.progress}
                {workspace.job.data?.progress && (
                  <span>
                    {workspace.job.data.progress.chunks_done} /{' '}
                    {workspace.job.data.progress.chunks_total} chunks
                  </span>
                )}
              </div>
            ) : (
              workspace.notice
            )}
          </div>
          {batch.items.length === 0 ? (
            <EmptyState
              title="No active strings to review"
              description="All strings in this batch are deleted or pending deletion."
            />
          ) : (
            <section aria-labelledby="batch-review-title" className="flex flex-col gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2
                  id="batch-review-title"
                  className="font-heading text-lg font-semibold tracking-tight"
                >
                  Review translations
                </h2>
                <p className="text-xs text-muted-foreground">
                  Compare with published content, then edit below.
                </p>
              </div>
              {visible.map((entry) => (
                <section
                  key={entry.id}
                  aria-label={`Review ${entry.key}`}
                  className="overflow-hidden rounded-xl border bg-card shadow-2xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs">
                      <span className="text-muted-foreground">
                        {entry.module_slug ?? 'Unassigned'}
                      </span>
                      <span aria-hidden="true" className="text-muted-foreground">
                        /
                      </span>
                      <h3 className="font-medium break-all">{entry.key}</h3>
                    </div>
                    <Badge variant="outline">
                      {entry.published_key == null
                        ? 'New to public'
                        : preview.publishableIds.includes(entry.id)
                          ? 'Changed'
                          : 'Published'}
                    </Badge>
                  </div>
                  <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                    <div className="flex min-w-0 flex-col gap-4 border-b bg-muted/30 p-5 lg:border-r lg:border-b-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="eyebrow">Source</p>
                        <Badge variant="secondary">{project?.base_language.toUpperCase()}</Badge>
                      </div>
                      <p
                        className="text-sm leading-relaxed font-medium whitespace-pre-wrap wrap-anywhere"
                        lang={project?.base_language}
                      >
                        {entry.source_text}
                      </p>
                      {entry.description && (
                        <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                          {entry.description}
                        </p>
                      )}
                      {entry.published_source_text != null && (
                        <div className="flex flex-col gap-1 text-xs leading-relaxed text-muted-foreground">
                          <p className="font-medium">Currently published</p>
                          <p
                            lang={project?.base_language}
                            className="whitespace-pre-wrap wrap-anywhere"
                          >
                            {entry.published_source_text}
                          </p>
                        </div>
                      )}
                      {(entry.published_key == null ? [] : contentFieldChanges(entry))
                        .filter((change) => change.field === 'key' || change.field === 'module')
                        .map((change) => (
                          <p key={change.field} className="text-xs text-muted-foreground break-all">
                            {change.label}: {change.published || '—'} → {change.working || '—'}
                          </p>
                        ))}
                    </div>
                    <FieldGroup className="min-w-0 gap-5 p-5">
                      {reviewLocales.map((locale) => {
                        const translation = entry.translations.find((t) => t.locale === locale)
                        const id = `${entry.id}:${locale}`
                        return (
                          <Field key={locale}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <FieldLabel htmlFor={id}>{locale.toUpperCase()}</FieldLabel>
                              <div className="flex flex-wrap items-center gap-2">
                                <ConfidenceBadge score={translation?.confidence} />
                                {qa[id] && (
                                  <QaLocaleBadge
                                    view={qa[id]}
                                    locale={locale}
                                    footer="Advisory only. You can still publish."
                                  />
                                )}
                              </div>
                            </div>
                            <Textarea
                              id={id}
                              lang={locale}
                              disabled={busy || workspace.stale}
                              rows={2}
                              value={translation?.value ?? ''}
                              placeholder="Missing translation"
                              aria-label={`${locale.toUpperCase()} translation for ${entry.key}`}
                              onChange={(event) =>
                                workspace.edit(entry, locale, event.target.value)
                              }
                            />
                            <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap wrap-anywhere">
                              Published: {translation?.published_value || '—'}
                            </p>
                          </Field>
                        )
                      })}
                    </FieldGroup>
                  </div>
                </section>
              ))}
            </section>
          )}
          <DataPagination
            page={activePage}
            pageSize={50}
            total={batch.items.length}
            onPageChange={setPage}
            disabled={busy}
          />
          {missing > 0 && (
            <p className="text-sm text-muted-foreground">
              {missing} missing translations will export as empty values if published.
            </p>
          )}
          <footer className="sticky bottom-0 z-10 -mx-4 -mb-6 flex flex-wrap items-center justify-between gap-4 border-t bg-background px-4 py-4 sm:-mx-6 sm:-mb-8 sm:px-6">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                {workspace.published && (
                  <Check aria-hidden="true" className="size-4 text-primary" />
                )}
                {workspace.published
                  ? 'Batch published'
                  : publishable
                    ? `${publishable} changed strings · ${reviewLocales.map((l) => l.toUpperCase()).join(', ') || 'Source only'}`
                    : 'Batch is in sync with public.'}
              </p>
              <p className="max-w-lg text-xs leading-relaxed text-muted-foreground">
                {workspace.published
                  ? 'Available on the next public pull or export.'
                  : 'Nothing is saved until you publish. Leaving or reloading discards your progress.'}
              </p>
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              {(workspace.started || workspace.error) && (
                <Button variant="outline" disabled={busy} onClick={() => setRestartOpen(true)}>
                  <RotateCcw data-icon="inline-start" /> Restart workflow
                </Button>
              )}
              <Button
                disabled={busy || workspace.stale || !publishable}
                onClick={() => void workspace.publish()}
              >
                {workspace.publishing ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Upload data-icon="inline-start" />
                )}
                Publish batch
              </Button>
            </div>
          </footer>
        </>
      ) : null}
      <ConfirmDialog
        open={restartOpen}
        onClose={() => setRestartOpen(false)}
        onConfirm={() => {
          setRestartOpen(false)
          setPage(1)
          void workspace.restart()
        }}
        title="Restart this workflow?"
        description="Your temporary translations and edits will be discarded. Start again from the saved CLI push."
        confirmLabel="Discard and restart"
        cancelLabel="Keep reviewing"
      />
      <ConfirmDialog
        open={workspace.blocker.status === 'blocked'}
        onClose={() => workspace.blocker.reset?.()}
        onConfirm={() => workspace.blocker.proceed?.()}
        title="Leave this workflow?"
        description="Your temporary translations and edits will be discarded. You will need to start again when you return."
        confirmLabel="Discard and leave"
        cancelLabel="Keep reviewing"
      />
    </PageBody>
  )
}
