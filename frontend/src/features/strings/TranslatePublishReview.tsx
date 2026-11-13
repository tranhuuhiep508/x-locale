import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import type { StringEntry } from '@/lib/api/types'
import { PublishPreviewContent } from './PublishPreviewDialog'
import { buildPublishPreview } from './publish-preview'
import { emptyPublicLocales } from './translate-review'

/** In-place publication review for the AI review dialog; this is the only confirmation. */
export function TranslatePublishReview({
  entries,
  loading,
}: {
  entries: StringEntry[] | null
  loading: boolean
}) {
  if (!entries) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-sm text-muted-foreground" aria-live="polite">
        {loading ? <Spinner /> : null}
        Preparing publication review…
      </div>
    )
  }
  const preview = buildPublishPreview(entries)
  const empty = emptyPublicLocales(entries)
  return (
    <div className="flex flex-col gap-4 animate-step-fade" aria-busy={loading}>
      {empty.length > 0 ? (
        <Alert>
          <AlertTitle>
            {empty.length} {empty.length === 1 ? 'string has' : 'strings have'} empty locales
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-1 flex flex-col gap-0.5">
              {empty.map((row) => (
                <li key={row.id} className="text-xs">
                  <code className="font-mono" translate="no">{row.key}</code>
                  {' · '}
                  <span className="font-mono uppercase">{row.locales.join(', ')}</span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <PublishPreviewContent preview={preview} />
    </div>
  )
}
