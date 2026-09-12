import { useDeferredValue, useEffect, useRef, useState } from 'react'
import type { ImportResult } from '@/lib/api/types'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  PASTE_KIND_ORDER,
  PASTE_SECTION_LABEL,
  buildPastePreview,
  filterKeys,
  hasPasteWrites,
  keysForKind,
  type PasteKind,
} from '@/features/strings/paste-preview'

const ROW_HEIGHT = 32
const LIST_MAX_HEIGHT = 280
const VIRTUALIZE_AFTER = 60
const OVERSCAN = 10

function VirtualKeyList({ keys, ariaLabel }: { keys: string[]; ariaLabel: string }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualize = keys.length > VIRTUALIZE_AFTER
  const viewportHeight = Math.min(Math.max(keys.length, 1) * ROW_HEIGHT, LIST_MAX_HEIGHT)
  const [range, setRange] = useState({
    start: 0,
    end: virtualize ? Math.min(keys.length, VIRTUALIZE_AFTER) : keys.length,
  })

  function updateRange(el: HTMLDivElement) {
    const top = el.scrollTop
    const height = el.clientHeight || LIST_MAX_HEIGHT
    const start = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN)
    const end = Math.min(keys.length, Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN)
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }

  useEffect(() => {
    if (!virtualize) {
      setRange({ start: 0, end: keys.length })
      return
    }
    const el = parentRef.current
    if (el) updateRange(el)
    else setRange({ start: 0, end: Math.min(keys.length, VIRTUALIZE_AFTER) })
  }, [keys, virtualize])

  const visible = virtualize ? keys.slice(range.start, range.end) : keys

  return (
    <div
      ref={parentRef}
      className="overflow-y-auto overscroll-contain rounded-lg border border-border/80 bg-background/60"
      style={{ height: viewportHeight }}
      onScroll={virtualize ? (event) => updateRange(event.currentTarget) : undefined}
    >
      <ul
        aria-label={ariaLabel}
        className="relative m-0 list-none p-0"
        style={virtualize ? { height: keys.length * ROW_HEIGHT } : undefined}
      >
        {visible.map((key, index) => {
          const itemIndex = virtualize ? range.start + index : index
          return (
            <li
              key={key}
              className="flex items-center px-3 font-mono text-xs break-all"
              style={
                virtualize
                  ? {
                      position: 'absolute',
                      top: itemIndex * ROW_HEIGHT,
                      left: 0,
                      right: 0,
                      height: ROW_HEIGHT,
                    }
                  : { minHeight: ROW_HEIGHT }
              }
              translate="no"
            >
              {key}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function PasteSection({
  kind,
  keys,
  query,
}: {
  kind: PasteKind
  keys: string[]
  query: string
}) {
  if (keys.length === 0) return null
  const filtered = filterKeys(keys, query)
  const headingId = `add-many-${kind}`
  return (
    <section className="flex flex-col gap-2" aria-label={PASTE_SECTION_LABEL[kind]}>
      <h3
        id={headingId}
        className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
      >
        {PASTE_SECTION_LABEL[kind]}
      </h3>
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matching keys</p>
      ) : (
        <VirtualKeyList keys={filtered} ariaLabel={`${PASTE_SECTION_LABEL[kind]} keys`} />
      )}
    </section>
  )
}

export function PastePreviewPanel({ result }: { result: ImportResult | null }) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const preview = buildPastePreview(result)

  if (!hasPasteWrites(preview)) {
    return (
      <EmptyState
        title="Nothing to add"
        description="These keys are already in the catalog, or the paste was empty."
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Field>
        <FieldLabel htmlFor="add-many-key-search">Search keys</FieldLabel>
        <Input
          id="add-many-key-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by key…"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      {PASTE_KIND_ORDER.map((kind) => (
        <PasteSection
          key={kind}
          kind={kind}
          keys={keysForKind(preview, kind)}
          query={deferredQuery}
        />
      ))}
    </div>
  )
}
