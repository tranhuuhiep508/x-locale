import type { StringEntry } from '@/lib/api/types'
import { PublishPreviewContent } from './PublishPreviewDialog'
import { buildPublishPreview } from './publish-preview'

export function EditorPublicationReview({ entry }: { entry: StringEntry }) {
  const preview = buildPublishPreview([entry])

  return (
    <div className="flex flex-col gap-5">
      <PublishPreviewContent preview={preview} />

      <section aria-label="Complete proposed public content" className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Complete proposed public content
        </h3>
        <div className="rounded-xl border border-border/80 bg-card text-xs divide-y divide-border/60 overflow-hidden shadow-2xs">
          <div className="flex items-center justify-between px-3.5 py-2.5 bg-muted/20">
            <span className="font-mono text-xs font-medium text-foreground">{entry.key}</span>
            {entry.module_slug ? (
              <span className="font-mono text-[11px] text-muted-foreground rounded bg-muted px-1.5 py-0.5">
                {entry.module_slug}
              </span>
            ) : null}
          </div>
          <div className="px-3.5 py-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
              Source text
            </span>
            <p className="text-xs font-medium text-foreground whitespace-pre-wrap">{entry.source_text}</p>
          </div>
          {entry.translations.map((item) => (
            <div key={item.locale} className="flex items-start gap-3 px-3.5 py-2.5">
              <span className="font-mono text-[10px] font-bold uppercase rounded bg-muted px-1.5 py-0.5 shrink-0 text-muted-foreground">
                {item.locale}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap text-xs text-foreground">
                {item.value || <span className="italic text-muted-foreground">(empty)</span>}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
