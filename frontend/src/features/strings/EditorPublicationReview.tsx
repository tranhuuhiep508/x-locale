import type { StringEntry } from '@/lib/api/types'
import { PublishPreviewContent } from './PublishPreviewDialog'
import { buildPublishPreview, previewCountLabel } from './publish-preview'

export function EditorPublicationReview({ entry }: { entry: StringEntry }) {
  const preview = buildPublishPreview([entry])
  const content = [
    ['Key', entry.key], ['Module', entry.module_slug ?? 'Unassigned'],
    ['Source', entry.source_text],
    ...entry.translations.map((item) => [item.locale.toUpperCase(), item.value || '(empty)']),
  ]
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">{previewCountLabel(preview.counts) || 'Nothing to publish'}. Publishing saves your edits and promotes the complete working copy.</p>
      <PublishPreviewContent preview={preview} />
      <section aria-label="Complete proposed public content" className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Complete proposed public content</h3>
        <dl className="flex flex-col gap-2 rounded-lg border p-3">
          {content.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-sm whitespace-pre-wrap wrap-anywhere">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-label="Working-copy data" className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Working-copy data</h3>
        <p className="text-xs text-muted-foreground">Saved with this action; these fields are not part of the public snapshot.</p>
        <dl className="text-sm whitespace-pre-wrap wrap-anywhere">
          <dt className="text-xs text-muted-foreground">Description</dt><dd>{entry.description || '(empty)'}</dd>
          <dt className="text-xs text-muted-foreground">Tags</dt><dd>{entry.tags.map((tag) => tag.name).join(', ') || '(none)'}</dd>
          {entry.translations.map((item) => (
            <div key={item.locale}>
              <dt className="text-xs text-muted-foreground">{item.locale.toUpperCase()} confidence</dt>
              <dd>{item.confidence == null ? 'Unscored' : `${item.confidence}%`}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
