import {
  CheckCircle,
  MoveRight,
  RotateCcw,
  Tag as TagIcon,
  Trash2,
  Undo2,
  X,
  XCircle,
} from 'lucide-react'
import type { Module, Tag } from '@/lib/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

export function BatchActionBar({
  selectedCount,
  visible,
  pending,
  modules,
  tags,
  onPublish,
  onUnpublish,
  onMove,
  onAddTags,
  onDelete,
  onDiscardChanges,
  onDiscardDelete,
  onRestore,
  onClear,
  showDiscardChanges,
  showDiscardDelete,
  showRestore,
}: {
  selectedCount: number
  visible: boolean
  pending?: boolean
  modules: Module[]
  tags: Tag[]
  showDiscardChanges: boolean
  showDiscardDelete: boolean
  showRestore: boolean
  onPublish: () => void
  onUnpublish: () => void
  onMove: () => void
  onAddTags: () => void
  onDelete: () => void
  onDiscardChanges: () => void
  onDiscardDelete: () => void
  onRestore: () => void
  onClear: () => void
}) {
  const open = visible && selectedCount > 0
  const busy = Boolean(pending)

  return (
    <div
      role="toolbar"
      aria-label="Batch actions"
      aria-hidden={!open}
      aria-busy={busy}
      inert={!open}
      className={cn(
        'flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-input bg-popover py-1 pr-1 pl-2 text-popover-foreground shadow-sm ring-1 ring-foreground/10 transition-opacity duration-200 ease-drift',
        open ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
        <div className="flex items-center gap-2 py-0.5 pr-1">
          {busy ? (
            <Spinner className="size-3.5 text-muted-foreground" />
          ) : (
            <Badge>{selectedCount}</Badge>
          )}
          <span className="text-sm text-foreground">selected</span>
        </div>

        <Separator orientation="vertical" className="mx-0.5 h-5" />

        <Button variant="default" size="sm" disabled={busy} onClick={onPublish}>
          <CheckCircle data-icon="inline-start" />
          Publish
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={onUnpublish}>
          <XCircle data-icon="inline-start" />
          Unpublish
        </Button>

        {modules.length > 0 || tags.length > 0 ? (
          <Separator orientation="vertical" className="mx-0.5 h-5" />
        ) : null}

        {modules.length > 0 ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={onMove}>
            <MoveRight data-icon="inline-start" />
            Move
          </Button>
        ) : null}
        {tags.length > 0 ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={onAddTags}>
            <TagIcon data-icon="inline-start" />
            Tags
          </Button>
        ) : null}

        {showDiscardChanges || showDiscardDelete || showRestore ? (
          <Separator orientation="vertical" className="mx-0.5 h-5" />
        ) : null}

        {showDiscardChanges ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={onDiscardChanges}>
            <Undo2 data-icon="inline-start" />
            Discard changes
          </Button>
        ) : null}
        {showDiscardDelete ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={onDiscardDelete}>
            <RotateCcw data-icon="inline-start" />
            Discard delete
          </Button>
        ) : null}
        {showRestore ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={onRestore}>
            <RotateCcw data-icon="inline-start" />
            Restore
          </Button>
        ) : null}

        <Separator orientation="vertical" className="mx-0.5 h-5" />

        <Button variant="destructive" size="sm" disabled={busy} onClick={onDelete}>
          <Trash2 data-icon="inline-start" />
          Delete
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label="Clear selection"
          onClick={onClear}
        >
          <X />
        </Button>
    </div>
  )
}
