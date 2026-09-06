import { useEffect, useState } from 'react'
import { CheckCircle2, Search, X } from 'lucide-react'
import type { ImportDiff, ImportResult } from '@/lib/api/types'
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import {
  hasMatchingImportKeys,
  importKeyListFooter,
  visibleImportKeys,
} from '@/features/sync/import-preview'

const SECTIONS: {
  id: keyof Pick<ImportDiff, 'create' | 'update' | 'orphan'>
  title: string
  label: string
  prefix: string
  hint?: string
}[] = [
  { id: 'create', title: 'New strings', label: 'new', prefix: '+' },
  { id: 'update', title: 'Updated', label: 'updated', prefix: '~' },
  {
    id: 'orphan',
    title: 'In catalog, not in file',
    label: 'leftover',
    prefix: '·',
    hint: 'Import never deletes these keys.',
  },
]

function ImportDiffSection({
  title,
  label,
  prefix,
  keys,
  query,
  hint,
}: {
  title: string
  label: string
  prefix: string
  keys: string[]
  query: string
  hint?: string
}) {
  const visible = visibleImportKeys(keys, query)
  if (visible.matchCount === 0) return null
  const footer = importKeyListFooter({
    query,
    matchCount: visible.matchCount,
    total: visible.total,
    label,
  })
  const headingCount = query.trim() ? visible.matchCount : visible.total

  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-muted-foreground">
        {title} ({headingCount})
      </h3>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
        {visible.items.map((key) => (
          <code
            key={key}
            className="block truncate rounded bg-muted px-2 py-0.5 text-xs text-foreground"
          >
            {prefix} {key}
          </code>
        ))}
      </div>
      {footer ? <p className="text-xs text-muted-foreground">{footer}</p> : null}
    </section>
  )
}

export function ImportPreviewDialog({
  open,
  result,
  applying,
  onOpenChange,
  onApply,
}: {
  open: boolean
  result: ImportResult | null
  applying: boolean
  onOpenChange: (open: boolean) => void
  onApply: () => void
}) {
  const [query, setQuery] = useState('')
  const diff = result?.diff ?? null
  const unchanged =
    (diff?.create_count ?? 0) === 0 &&
    (diff?.update_count ?? 0) === 0 &&
    (diff?.orphan_count ?? 0) === 0
  const sections = diff ? [diff.create, diff.update, diff.orphan] : []
  const hasList = sections.some((keys) => keys.length > 0)
  const hasMatches = hasMatchingImportKeys(sections, query)

  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onOpenChange(false)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import preview (dry run)</DialogTitle>
          <DialogDescription>Nothing is saved yet. Review changes before applying.</DialogDescription>
        </DialogHeader>

        {diff ? (
          <div className="flex max-h-[min(60vh,28rem)] flex-col gap-3 overflow-y-auto">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-muted p-3">
                <p className="text-2xl font-bold text-foreground">{diff.create_count}</p>
                <p className="text-xs text-muted-foreground">New strings</p>
              </div>
              <div className="rounded-lg bg-muted p-3">
                <p className="text-2xl font-bold text-foreground">{diff.update_count}</p>
                <p className="text-xs text-muted-foreground">Updated</p>
              </div>
              <div className="rounded-lg bg-muted p-3">
                <p className="text-2xl font-bold text-foreground">{diff.orphan_count}</p>
                <p className="text-xs text-muted-foreground">Not in file</p>
              </div>
            </div>

            {unchanged ? (
              <EmptyState
                className="py-6"
                icon={<CheckCircle2 />}
                title="No changes"
                description="This file matches the catalog. Nothing would be written."
              />
            ) : (
              <>
                {hasList ? (
                  <InputGroup>
                    <InputGroupAddon>
                      <Search />
                    </InputGroupAddon>
                    <InputGroupInput
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Filter keys…"
                      aria-label="Filter keys"
                    />
                    {query ? (
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          size="icon-xs"
                          aria-label="Clear filter"
                          onClick={() => setQuery('')}
                        >
                          <X />
                        </InputGroupButton>
                      </InputGroupAddon>
                    ) : null}
                  </InputGroup>
                ) : null}

                {hasMatches ? (
                  SECTIONS.map((section) => (
                    <ImportDiffSection
                      key={section.id}
                      title={section.title}
                      label={section.label}
                      prefix={section.prefix}
                      keys={diff[section.id]}
                      query={query}
                      hint={section.hint}
                    />
                  ))
                ) : query.trim() ? (
                  <p className="text-sm text-muted-foreground">
                    No keys match “{query.trim()}”
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onApply} disabled={applying}>
            {applying ? <Spinner data-icon="inline-start" /> : null}
            Apply import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
