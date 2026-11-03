import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Check, Globe2, Pencil, RotateCcw, Upload, Wand2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DataPagination } from '@/components/ui/data-pagination'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { PageBody } from '@/components/layout/PageHeader'
import { useQaWatch } from '@/features/strings/use-qa-watch'
import { QaLocaleBadge } from '@/features/strings/qa-issue-view'
import { ConfidenceBadge } from '@/features/strings/confidence'
import { contentFieldChanges } from '@/features/strings/publish-preview'
import { useBatchWorkspace } from '@/features/batches/use-batch-workspace'
import { BatchStepper } from '@/features/batches/BatchStepper'
import { cn, formatRelativeTime } from '@/lib/utils'

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
      locales.map((locale) => {
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
    <PageBody className="gap-3 py-4 sm:py-5">
      <header className="sticky top-0 z-20 -mx-4 -mt-4 flex flex-col gap-2 border-b bg-background px-4 py-2 sm:-mx-6 sm:-mt-5 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="icon" asChild>
              <Link
                to="/projects/$projectRef/activity"
                params={{ projectRef }}
                search={{}}
                aria-label="Back to Activity"
              >
                <ArrowLeft />
              </Link>
            </Button>
            <div className="min-w-0">
              <h1 className="font-heading text-lg font-semibold tracking-tight">CLI push batch</h1>
              {batch && (
                <p className="text-xs text-muted-foreground">
                  {batch.actor_label} ·{' '}
                  {batch.created_at ? formatRelativeTime(batch.created_at) : 'CLI push'}
                </p>
              )}
            </div>
          </div>
          {batch && (
            <Badge variant={workspace.published || !publishable ? 'secondary' : 'outline'}>
              {workspace.published
                ? 'Published'
                : publishable
                  ? 'Unpublished changes'
                  : 'In sync with public'}
            </Badge>
          )}
        </div>
        {batch && <BatchStepper current={currentStep} />}
      </header>
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
            <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/30 px-4 py-2 sm:px-5">
              <div className="flex min-w-0 flex-col gap-1">
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
                  !workspace.canTranslate ||
                  Boolean(workspace.refreshError) ||
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
                {workspace.unresolvedCount ? 'Retry unresolved' : 'Translate all'}
              </Button>
            </div>
          </div>
          {batch.excluded_count > 0 && (
            <p className="text-sm text-muted-foreground">
              {batch.excluded_count} deleted or pending-delete strings excluded. Manage them in
              Strings.
            </p>
          )}
          {workspace.refreshError && (
            <Alert>
              <AlertTitle>Batch published</AlertTitle>
              <AlertDescription>
                <p>{workspace.refreshError}</p>
                <Button
                  variant="outline"
                  disabled={workspace.refreshing}
                  onClick={() => void workspace.refreshPublished()}
                >
                  Retry refresh
                </Button>
              </AlertDescription>
            </Alert>
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
          <div
            role="status"
            aria-live="polite"
            className="text-sm text-muted-foreground empty:hidden"
          >
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
            <section aria-labelledby="batch-review-title" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2
                  id="batch-review-title"
                  className="font-heading text-lg font-semibold tracking-tight"
                >
                  Review translations
                </h2>
                <div
                  className="flex items-center gap-4 text-xs text-muted-foreground"
                  aria-label="Comparison legend"
                >
                  <span className="flex items-center gap-1">
                    <Globe2 aria-hidden="true" className="size-3.5" /> Published
                  </span>
                  <span className="flex items-center gap-1">
                    <Pencil aria-hidden="true" className="size-3.5 text-primary" /> To publish
                  </span>
                </div>
              </div>
              {visible.map((entry) => (
                <section
                  key={entry.id}
                  aria-label={`Review ${entry.key}`}
                  className="overflow-hidden rounded-xl border bg-card shadow-2xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
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
                    <div className="flex min-w-0 flex-col gap-2 border-b bg-muted/30 p-3 lg:border-r lg:border-b-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="eyebrow">Source</p>
                        <Badge variant="secondary">{project?.base_language.toUpperCase()}</Badge>
                      </div>
                      <div
                        className="flex min-w-0 items-start gap-2 rounded-md border bg-background p-2"
                        aria-label="Published source"
                      >
                        <Globe2
                          aria-hidden="true"
                          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                        />
                        <p
                          lang={project?.base_language}
                          className="text-sm whitespace-pre-wrap wrap-anywhere"
                        >
                          {entry.published_source_text ?? 'Not published yet'}
                        </p>
                      </div>
                      <div
                        className={cn(
                          'flex min-w-0 items-start gap-2 rounded-md border p-2',
                          entry.source_text !== entry.published_source_text &&
                            'border-primary/40 bg-primary/5'
                        )}
                      >
                        <Pencil
                          aria-hidden="true"
                          className="mt-0.5 size-3.5 shrink-0 text-primary"
                        />
                        <span className="sr-only">Source to publish: </span>
                        <p
                          lang={project?.base_language}
                          className="text-sm font-medium whitespace-pre-wrap wrap-anywhere"
                        >
                          {entry.source_text}
                        </p>
                      </div>
                      {entry.description && (
                        <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                          {entry.description}
                        </p>
                      )}
                      {(entry.published_key == null ? [] : contentFieldChanges(entry))
                        .filter((change) => change.field === 'key' || change.field === 'module')
                        .map((change) => (
                          <p key={change.field} className="text-xs text-muted-foreground break-all">
                            {change.label}: {change.published || '—'} → {change.working || '—'}
                          </p>
                        ))}
                    </div>
                    <FieldGroup className="grid min-w-0 gap-3 p-3 xl:grid-cols-2">
                      {reviewLocales.map((locale) => {
                        const translation = entry.translations.find((t) => t.locale === locale)
                        const id = `${entry.id}:${locale}`
                        const changed =
                          (translation?.value ?? '') !== (translation?.published_value ?? '')
                        return (
                          <Field key={locale} className="gap-1">
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
                            <div
                              className="flex min-w-0 items-start gap-2 rounded-md border bg-muted/40 px-2.5 py-2"
                              aria-label={`${locale.toUpperCase()} published translation`}
                            >
                              <Globe2
                                aria-hidden="true"
                                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                              />
                              <p
                                lang={locale}
                                className="text-sm whitespace-pre-wrap wrap-anywhere"
                              >
                                {translation?.published_value == null
                                  ? 'Not published yet'
                                  : translation.published_value || 'Empty'}
                              </p>
                            </div>
                            <div className="relative min-w-0">
                              <Pencil
                                aria-hidden="true"
                                className="pointer-events-none absolute top-3 left-2.5 size-3.5 text-primary"
                              />
                              <Textarea
                                id={id}
                                lang={locale}
                                disabled={
                                  busy || workspace.stale || Boolean(workspace.refreshError)
                                }
                                readOnly={!locales.includes(locale)}
                                rows={1}
                                className={cn(
                                  'min-h-10 py-1.5 pl-8',
                                  changed && 'border-primary/60 bg-primary/5'
                                )}
                                value={translation?.value ?? ''}
                                placeholder="Missing translation"
                                aria-label={`${locale.toUpperCase()} translation for ${entry.key}`}
                                onChange={(event) =>
                                  workspace.edit(entry, locale, event.target.value)
                                }
                              />
                            </div>
                            <span className="sr-only">
                              {changed ? 'Changed from published' : 'No change from published'}
                            </span>
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
          <footer className="sticky bottom-0 z-10 -mx-4 -mb-6 flex flex-wrap items-center justify-between gap-2 border-t bg-background px-4 py-2 sm:-mx-6 sm:-mb-8 sm:px-6">
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
                  : 'Edits are temporary until published.'}
              </p>
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              {(workspace.started || workspace.error) && (
                <Button variant="outline" disabled={busy} onClick={() => setRestartOpen(true)}>
                  <RotateCcw data-icon="inline-start" /> Restart workflow
                </Button>
              )}
              <Button
                disabled={
                  busy ||
                  workspace.stale ||
                  Boolean(workspace.refreshError) ||
                  workspace.unresolvedCount > 0 ||
                  (!publishable && !workspace.hasTranslationChanges)
                }
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
