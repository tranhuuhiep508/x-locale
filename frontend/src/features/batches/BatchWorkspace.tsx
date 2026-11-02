import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Check, Upload, Wand2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DataPagination } from '@/components/ui/data-pagination'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
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
import { formatRelativeTime } from '@/lib/utils'

export function BatchWorkspace({ projectRef, batchId }: { projectRef: string; batchId: string }) {
  const workspace = useBatchWorkspace(projectRef, batchId)
  const [page, setPage] = useState(1)
  const { query, project, busy, saving, edits, chosen, locales, preview } = workspace
  const batch = query.data
  const blocked = busy || saving
  const publishable = preview.publishableIds.length
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
          text: edits[id]?.value ?? value,
          baseline: { source: entry.source_text, text: value, issues: workspace.issues[id] },
        }
      })
    ),
    !busy
  )

  return (
    <PageBody className="gap-5">
      <div>
        <Button variant="link" asChild>
          <Link to="/projects/$projectRef/activity" params={{ projectRef }} search={{}}>
            <ArrowLeft data-icon="inline-start" /> Activity
          </Link>
        </Button>
      </div>
      <PageHeader
        eyebrow="Batch review"
        title="CLI push batch"
        description={
          batch ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>
                {batch.actor_label} ·{' '}
                {batch.created_at ? formatRelativeTime(batch.created_at) : 'CLI push'}
              </span>
              <Badge variant="outline">
                {publishable ? 'Unpublished changes' : 'In sync with public'}
              </Badge>
            </div>
          ) : (
            'Translate, review, and publish this push.'
          )
        }
      />
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
          <ol
            aria-label="Batch progress"
            className="flex flex-wrap items-center gap-5 text-sm text-muted-foreground"
          >
            <li className="flex items-center gap-2">
              <Check className="size-4" /> Pushed
            </li>
            <li>Translate</li>
            <li>Review</li>
            <li className="flex items-center gap-2">
              {!publishable && <Check className="size-4" />} Publish
            </li>
          </ol>
          <Separator />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="font-medium">{batch.items.length} strings in this batch</h2>
              <p className="text-sm text-muted-foreground">
                {batch.created_count} new · {batch.updated_count} updated · Source:{' '}
                {project?.base_language.toUpperCase()}
              </p>
              {batch.excluded_count > 0 && (
                <p className="text-sm text-muted-foreground">
                  {batch.excluded_count} deleted or pending-delete strings excluded. Manage them in
                  Strings.
                </p>
              )}
            </div>
            <Button
              onClick={() => void workspace.translate()}
              disabled={
                blocked ||
                workspace.dirty ||
                workspace.remaining.length > 0 ||
                !chosen.length ||
                !batch.items.length
              }
            >
              <Wand2 data-icon="inline-start" /> Translate all
            </Button>
          </div>
          {locales.length > 0 && (
            <FieldSet disabled={blocked || workspace.remaining.length > 0}>
              <FieldLegend variant="label">Languages to translate</FieldLegend>
              <FieldGroup className="flex-row flex-wrap gap-4">
                {locales.map((locale) => (
                  <Field key={locale} orientation="horizontal" className="w-auto">
                    <Checkbox
                      id={`batch-language-${locale}`}
                      checked={chosen.includes(locale)}
                      onCheckedChange={(checked) =>
                        workspace.setSelected(
                          checked ? [...chosen, locale] : chosen.filter((l) => l !== locale)
                        )
                      }
                    />
                    <FieldLabel htmlFor={`batch-language-${locale}`}>
                      {locale.toUpperCase()}
                    </FieldLabel>
                  </Field>
                ))}
              </FieldGroup>
            </FieldSet>
          )}
          <p className="text-sm text-muted-foreground">
            Translate all replaces working translations in the selected languages. Publishing
            includes every locale shown below.
          </p>
          {(workspace.error || workspace.remaining.length > 0) && (
            <Alert variant="destructive">
              <AlertTitle>Review needed</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-2">
                <p>{workspace.error}</p>
                {workspace.remaining.length > 0 && (
                  <Button
                    variant="outline"
                    disabled={blocked}
                    onClick={() => void workspace.retryApply()}
                  >
                    Retry saving {workspace.remaining.length} remaining strings
                  </Button>
                )}
                {workspace.conflicted.length > 0 && (
                  <Button
                    variant="outline"
                    disabled={blocked}
                    onClick={() => void workspace.keepLatest()}
                  >
                    Keep latest for changed strings
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={blocked}
                  onClick={() => void workspace.refresh()}
                >
                  Refresh review
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {workspace.needsReview && (
            <Alert>
              <AlertDescription>
                Review the latest content, then refresh review to enable publishing.
                <Button
                  variant="outline"
                  disabled={blocked}
                  onClick={() => void workspace.refresh()}
                >
                  Refresh review
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {busy && (
            <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
              <Spinner />
              {workspace.progress || 'Working…'}
              {workspace.job.data?.progress && (
                <span>
                  {workspace.job.data.progress.chunks_done} /{' '}
                  {workspace.job.data.progress.chunks_total} chunks
                </span>
              )}
            </div>
          )}
          {workspace.job.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                Could not check translation progress. No results have been applied.
                <Button variant="outline" onClick={() => void workspace.job.refetch()}>
                  Retry status
                </Button>
                <Button variant="outline" onClick={workspace.stopJob}>
                  Stop tracking
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {batch.items.length === 0 ? (
            <EmptyState
              title="No active strings to review"
              description="All strings in this batch are deleted or pending deletion."
            />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card shadow-2xs">
              {visible.map((entry) => (
                <section
                  key={entry.id}
                  aria-label={`Review ${entry.key}`}
                  className="grid min-w-0 gap-5 border-b p-5 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
                >
                  <div className="flex min-w-0 flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {entry.module_slug ?? 'Unassigned'}
                      </span>
                      <Badge variant="outline">
                        {entry.published_key == null ? 'New to public' : 'Public'}
                      </Badge>
                    </div>
                    <code className="font-mono text-xs break-all">{entry.key}</code>
                    <div>
                      <p className="eyebrow mb-1">
                        Source · {project?.base_language.toUpperCase()}
                      </p>
                      <p
                        className="text-sm font-medium whitespace-pre-wrap wrap-anywhere"
                        lang={project?.base_language}
                      >
                        {entry.source_text}
                      </p>
                    </div>
                    {entry.description && (
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                        {entry.description}
                      </p>
                    )}
                    {entry.published_source_text != null && (
                      <div className="text-xs text-muted-foreground">
                        <p>Published source</p>
                        <p className="whitespace-pre-wrap">{entry.published_source_text}</p>
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
                  <FieldGroup className="grid min-w-0 gap-4 sm:grid-cols-2">
                    {locales.map((locale) => {
                      const translation = entry.translations.find((t) => t.locale === locale)
                      const id = `${entry.id}:${locale}`,
                        draft = edits[id]
                      return (
                        <Field key={locale} data-invalid={Boolean(draft?.error)}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <FieldLabel htmlFor={id}>{locale.toUpperCase()}</FieldLabel>
                            <div className="flex flex-wrap items-center gap-2">
                              <ConfidenceBadge score={draft ? null : translation?.confidence} />
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
                            disabled={blocked}
                            rows={2}
                            value={draft?.value ?? translation?.value ?? ''}
                            placeholder="Missing translation"
                            aria-invalid={Boolean(draft?.error)}
                            aria-label={`${locale.toUpperCase()} translation for ${entry.key}`}
                            onChange={(event) => workspace.edit(entry, locale, event.target.value)}
                            onBlur={() => void workspace.save(entry, locale)}
                          />
                          <p className="text-xs text-muted-foreground whitespace-pre-wrap wrap-anywhere">
                            Published: {translation?.published_value || '—'}
                          </p>
                          {draft?.error && (
                            <div
                              role="alert"
                              className="flex flex-col items-start gap-2 text-xs text-destructive"
                            >
                              <p>{draft.error}</p>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void workspace.retryEdit(id)}
                              >
                                Load latest baseline
                              </Button>
                            </div>
                          )}
                          {draft && !draft.error && (
                            <p className="text-xs text-muted-foreground">Unsaved · saves on blur</p>
                          )}
                        </Field>
                      )
                    })}
                  </FieldGroup>
                </section>
              ))}
            </div>
          )}
          <DataPagination
            page={activePage}
            pageSize={50}
            total={batch.items.length}
            onPageChange={setPage}
            disabled={blocked || workspace.dirty}
          />
          {missing > 0 && (
            <p className="text-sm text-muted-foreground">
              {missing} missing translations will export as empty values if published.
            </p>
          )}
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {saving ? 'Saving…' : workspace.notice}
          </p>
          <Separator />
          <footer className="flex flex-wrap items-center justify-between gap-4 pb-4">
            <div>
              <p className="text-sm font-medium">
                {publishable
                  ? `Publish ${publishable} changed strings across all locales.`
                  : 'Batch is in sync with public.'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Existing public translations stay live until you publish.
              </p>
            </div>
            <Button
              disabled={
                blocked ||
                workspace.dirty ||
                workspace.needsReview ||
                workspace.remaining.length > 0 ||
                !publishable
              }
              onClick={() => void workspace.publish()}
            >
              <Upload data-icon="inline-start" /> Publish batch · {publishable} strings
            </Button>
          </footer>
        </>
      ) : null}
    </PageBody>
  )
}
