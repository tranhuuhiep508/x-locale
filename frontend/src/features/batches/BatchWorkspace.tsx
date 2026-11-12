import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Check, Globe2, RotateCcw, Save, Upload, Wand2 } from 'lucide-react'
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
      : workspace.hasDrafts || workspace.savedAsDraft
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
    <PageBody className="gap-4 py-4 sm:py-5">
      <header className="sticky top-0 z-20 -mx-4 -mt-4 border-b bg-background/95 backdrop-blur-md px-4 py-2.5 sm:-mx-6 sm:-mt-5 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" className="size-8" asChild>
              <Link
                to="/projects/$projectRef/activity"
                params={{ projectRef }}
                search={{}}
                aria-label="Back to Activity"
              >
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-heading text-base font-semibold tracking-tight sm:text-lg">
                  CLI push batch
                </h1>
                {batch && (
                  <Badge
                    variant={
                      workspace.published
                        ? 'secondary'
                        : publishable
                          ? 'outline'
                          : 'secondary'
                    }
                    className="text-[11px]"
                  >
                    {workspace.published
                      ? 'Published'
                      : publishable
                        ? 'Unpublished changes'
                        : 'In sync with public'}
                  </Badge>
                )}
              </div>
              {batch && (
                <p className="text-xs text-muted-foreground truncate">
                  {batch.actor_label} ·{' '}
                  {batch.created_at ? formatRelativeTime(batch.created_at) : 'CLI push'}
                </p>
              )}
            </div>
          </div>
          {batch && <BatchStepper current={currentStep} />}
        </div>
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
          <div className="sky-panel relative overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
            <div
              className="animate-meridian-stream absolute inset-x-0 top-0 h-px"
              aria-hidden="true"
            />
            <div className="flex flex-col gap-3 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="font-heading text-base sm:text-lg font-semibold tracking-tight text-foreground">
                      {batch.items.length} strings in this batch
                    </h2>
                    <div className="flex items-center gap-1.5">
                      {batch.created_count > 0 && (
                        <Badge
                          variant="outline"
                          className="text-xs font-mono font-normal border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5"
                        >
                          +{batch.created_count} new
                        </Badge>
                      )}
                      {batch.updated_count > 0 && (
                        <Badge
                          variant="outline"
                          className="text-xs font-mono font-normal border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5"
                        >
                          ~{batch.updated_count} updated
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className="sr-only">
                    {batch.created_count} new · {batch.updated_count} updated · Source:{' '}
                    {project?.base_language.toUpperCase()}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Source:</span>
                    <Badge variant="secondary" className="font-mono text-xs font-medium">
                      {project?.base_language.toUpperCase()}
                    </Badge>
                    <span aria-hidden="true" className="text-muted-foreground/60">
                      →
                    </span>
                    <span className="sr-only">Project target languages</span>
                    <span className="font-medium text-foreground">Targets:</span>
                    {locales.map((locale) => (
                      <Badge key={locale} variant="outline" className="font-mono text-xs font-medium">
                        {locale.toUpperCase()}
                      </Badge>
                    ))}
                    {!locales.length && <span>No target languages configured</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => void workspace.translate()}
                    disabled={
                      busy ||
                      !workspace.canTranslate ||
                      workspace.stale ||
                      !locales.length ||
                      !batch.items.length
                    }
                    className="gap-2 shadow-xs"
                  >
                    {busy && !workspace.publishing ? (
                      <Spinner data-icon="inline-start" className="size-4" />
                    ) : (
                      <Wand2 data-icon="inline-start" className="size-4" />
                    )}
                    {workspace.unresolvedCount ? 'Retry unresolved' : 'Translate all'}
                  </Button>
                </div>
              </div>

              {(busy || workspace.notice) && (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-muted/40 px-3 py-2 text-xs sm:text-sm text-muted-foreground empty:hidden"
                >
                  {busy ? (
                    <div className="flex flex-wrap items-center gap-2 text-foreground font-medium">
                      <Spinner className="size-3.5" />
                      <span>{workspace.progress}</span>
                      {workspace.job.data?.progress && (
                        <span className="text-xs text-muted-foreground font-mono">
                          ({workspace.job.data.progress.chunks_done} /{' '}
                          {workspace.job.data.progress.chunks_total} chunks)
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-foreground">
                      <span>{workspace.notice}</span>
                    </div>
                  )}
                </div>
              )}

              {batch.excluded_count > 0 && (
                <p className="text-xs text-muted-foreground">
                  {batch.excluded_count} deleted or pending-delete strings excluded. Manage them in
                  Strings.
                </p>
              )}
            </div>
          </div>

          {workspace.refreshError && (
            <Alert>
              <AlertTitle>Batch saved</AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <p>{workspace.refreshError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={busy}
                  onClick={() => void workspace.restart()}
                >
                  Reload batch
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
                  <Button variant="outline" size="sm" onClick={() => void workspace.job.refetch()}>
                    Retry status
                  </Button>
                  <Button variant="outline" size="sm" onClick={workspace.stopJob}>
                    Stop tracking
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {batch.items.length === 0 ? (
            <EmptyState
              title="No active strings to review"
              description="All strings in this batch are deleted or pending deletion."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {visible.map((entry) => {
                const isSourceChanged =
                  entry.published_source_text != null &&
                  entry.published_source_text !== entry.source_text

                return (
                  <section
                    key={entry.id}
                    aria-label={`Review ${entry.key}`}
                    className="overflow-hidden rounded-xl border bg-card shadow-2xs transition-shadow hover:shadow-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3.5 py-2">
                      <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {entry.module_slug ?? 'Unassigned'}
                        </span>
                        <span aria-hidden="true" className="text-muted-foreground/60">
                          /
                        </span>
                        <h3 className="font-semibold text-foreground break-all">{entry.key}</h3>
                      </div>
                      <Badge
                        variant={
                          entry.published_key == null
                            ? 'outline'
                            : preview.publishableIds.includes(entry.id)
                              ? 'default'
                              : 'secondary'
                        }
                        className="text-[11px]"
                      >
                        {entry.published_key == null
                          ? 'New to public'
                          : preview.publishableIds.includes(entry.id)
                            ? 'Changed'
                            : 'Published'}
                      </Badge>
                    </div>

                    <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)]">
                      <div className="flex min-w-0 flex-col gap-2.5 border-b bg-muted/10 p-3.5 lg:border-r lg:border-b-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="eyebrow text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                            Source
                          </p>
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {project?.base_language.toUpperCase()}
                          </Badge>
                        </div>

                        {isSourceChanged ? (
                          <div
                            aria-label="Published source"
                            className="rounded-lg border border-border/70 bg-muted/30 p-2.5 text-xs"
                          >
                            <div className="flex items-center gap-1.5 font-medium text-muted-foreground mb-1">
                              <Globe2 aria-hidden="true" className="size-3 shrink-0" />
                              <span className="text-[10px] uppercase tracking-wider font-semibold">
                                Published:
                              </span>
                            </div>
                            <p
                              lang={project?.base_language}
                              className="text-muted-foreground whitespace-pre-wrap break-words line-through decoration-muted-foreground/50"
                            >
                              {entry.published_source_text}
                            </p>
                          </div>
                        ) : (
                          <span aria-label="Published source" className="sr-only">
                            {entry.published_source_text ?? 'Not published yet'}
                          </span>
                        )}

                        <div
                          className={cn(
                            'rounded-lg border p-2.5 transition-colors',
                            isSourceChanged
                              ? 'border-primary/40 bg-primary/5'
                              : 'border-border/60 bg-background/80'
                          )}
                        >
                          <span className="sr-only">Source to publish: </span>
                          <p
                            lang={project?.base_language}
                            className="text-sm font-medium leading-relaxed whitespace-pre-wrap break-words text-foreground"
                          >
                            {entry.source_text}
                          </p>
                        </div>

                        {entry.description && (
                          <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap bg-muted/20 rounded p-2 border border-border/30 italic">
                            {entry.description}
                          </p>
                        )}

                        {(entry.published_key == null ? [] : contentFieldChanges(entry))
                          .filter((change) => change.field === 'key' || change.field === 'module')
                          .map((change) => (
                            <div
                              key={change.field}
                              className="flex flex-wrap items-center gap-1.5 rounded bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
                            >
                              <span className="font-medium text-foreground">{change.label}:</span>
                              <span className="line-through text-muted-foreground/70">
                                {change.published || '—'}
                              </span>
                              <span>→</span>
                              <span className="font-semibold text-primary">
                                {change.working || '—'}
                              </span>
                            </div>
                          ))}
                      </div>

                      <FieldGroup className="grid min-w-0 gap-3 p-3.5 xl:grid-cols-2">
                        {reviewLocales.map((locale) => {
                          const translation = entry.translations.find((t) => t.locale === locale)
                          const id = `${entry.id}:${locale}`
                          const changed =
                            (translation?.value ?? '') !== (translation?.published_value ?? '')
                          const isReadOnly = !locales.includes(locale)
                          const hasPublished = translation?.published_value != null

                          return (
                            <Field key={locale} className="gap-1.5">
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <div className="flex items-center gap-1.5">
                                  <FieldLabel
                                    htmlFor={id}
                                    className="text-xs font-semibold font-mono tracking-wide"
                                  >
                                    {locale.toUpperCase()}
                                  </FieldLabel>
                                  {isReadOnly && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] py-0 px-1 text-muted-foreground font-mono"
                                    >
                                      Read-only
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <ConfidenceBadge score={translation?.confidence} />
                                  {qa[id] && (
                                    <QaLocaleBadge
                                      view={qa[id]}
                                      locale={locale}
                                      footer="Advisory only. You can still publish."
                                    />
                                  )}
                                  {changed && (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
                                      <span
                                        className="size-1.5 rounded-full bg-primary"
                                        aria-hidden="true"
                                      />
                                      <span>Changed</span>
                                    </span>
                                  )}
                                </div>
                              </div>

                              {hasPublished && changed ? (
                                <div
                                  aria-label={`${locale.toUpperCase()} published translation`}
                                  className="flex items-start gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground"
                                >
                                  <Globe2
                                    aria-hidden="true"
                                    className="size-3 mt-0.5 shrink-0 text-muted-foreground/70"
                                  />
                                  <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-1">
                                    <span className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground/70">
                                      Published:
                                    </span>
                                    <p lang={locale} className="break-all whitespace-pre-wrap">
                                      {translation.published_value || 'Empty'}
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <div
                                  aria-label={`${locale.toUpperCase()} published translation`}
                                  className="sr-only"
                                >
                                  {translation?.published_value == null
                                    ? 'Not published yet'
                                    : translation.published_value || 'Empty'}
                                </div>
                              )}

                              <Textarea
                                id={id}
                                lang={locale}
                                disabled={busy || workspace.stale}
                                readOnly={isReadOnly}
                                rows={2}
                                className={cn(
                                  'min-h-[56px] text-sm leading-relaxed transition-all',
                                  changed &&
                                    'border-primary/50 bg-primary/5 focus-visible:border-primary focus-visible:ring-primary/20',
                                  isReadOnly &&
                                    'bg-muted/40 text-muted-foreground cursor-not-allowed'
                                )}
                                value={translation?.value ?? ''}
                                placeholder="Missing translation"
                                aria-label={`${locale.toUpperCase()} translation for ${entry.key}`}
                                onChange={(event) =>
                                  workspace.edit(entry, locale, event.target.value)
                                }
                              />

                              <span className="sr-only">
                                {changed ? 'Changed from published' : 'No change from published'}
                              </span>
                            </Field>
                          )
                        })}
                      </FieldGroup>
                    </div>
                  </section>
                )
              })}
            </div>
          )}

          <DataPagination
            page={activePage}
            pageSize={50}
            total={batch.items.length}
            onPageChange={setPage}
            disabled={busy}
          />

          {missing > 0 && (
            <p className="text-xs text-muted-foreground">
              {missing} missing translations will export as empty values if published.
            </p>
          )}

          <footer className="sticky bottom-0 z-10 -mx-4 -mb-6 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 backdrop-blur-md px-4 py-3 sm:-mx-6 sm:-mb-8 sm:px-6 shadow-md">
            <div role="status" className="flex min-w-0 flex-col gap-0.5">
              <p className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
                {workspace.published && (
                  <Check aria-hidden="true" className="size-4 text-primary" />
                )}
                {workspace.published
                  ? 'Batch published'
                  : workspace.savedAsDraft
                    ? 'Batch saved as draft'
                    : publishable
                      ? `${publishable} changed strings · ${reviewLocales.map((l) => l.toUpperCase()).join(', ') || 'Source only'}`
                      : 'Batch is in sync with public.'}
              </p>
              <p className="max-w-xl text-xs text-muted-foreground truncate">
                {workspace.published
                  ? 'Available on the next public pull or export.'
                  : workspace.savedAsDraft
                    ? 'Saved to the working copy. Public translations are unchanged.'
                    : 'Edits are temporary until saved as draft or published.'}
              </p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {(workspace.started || workspace.error) && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setRestartOpen(true)}
                >
                  <RotateCcw data-icon="inline-start" className="size-3.5" /> Restart workflow
                </Button>
              )}
              <Button variant="ghost" size="sm" asChild>
                <Link
                  to="/projects/$projectRef/strings"
                  params={{ projectRef }}
                  search={{ batch_id: batchId, batch_kind: 'cli_push' }}
                >
                  View in Strings
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || workspace.stale || !workspace.hasTranslationChanges}
                onClick={() => void workspace.saveDraft()}
              >
                {workspace.savingDraft ? (
                  <Spinner data-icon="inline-start" className="size-3.5" />
                ) : (
                  <Save data-icon="inline-start" className="size-3.5" />
                )}
                Save as draft
              </Button>
              <Button
                size="sm"
                disabled={
                  busy ||
                  workspace.stale ||
                  workspace.unresolvedCount > 0 ||
                  (!publishable && !workspace.hasTranslationChanges)
                }
                onClick={() => void workspace.publish()}
              >
                {workspace.publishing ? (
                  <Spinner data-icon="inline-start" className="size-3.5" />
                ) : (
                  <Upload data-icon="inline-start" className="size-3.5" />
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
