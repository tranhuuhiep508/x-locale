import { CheckCircle, MoveRight, RotateCcw, Tag as TagIcon, Trash2, Undo2, X, XCircle } from 'lucide-react'
import type { Module, Tag } from '@/lib/api/types'
import { Button } from '@/components/ui/button'

export function BatchActionBar({
  selectedCount,
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
  return (
    <div className="flex shrink-0 items-center gap-3 bg-primary px-4 py-2 text-primary-foreground">
      <span className="text-sm font-medium">{selectedCount} selected</span>
      <div className="flex gap-1.5">
        <Button variant="secondary" size="sm" onClick={onPublish}>
          <CheckCircle data-icon="inline-start" />
          Publish
        </Button>
        <Button variant="secondary" size="sm" onClick={onUnpublish}>
          <XCircle data-icon="inline-start" />
          Unpublish
        </Button>
        {modules.length > 0 && (
          <Button variant="secondary" size="sm" onClick={onMove}>
            <MoveRight data-icon="inline-start" />
            Move module
          </Button>
        )}
        {tags.length > 0 && (
          <Button variant="secondary" size="sm" onClick={onAddTags}>
            <TagIcon data-icon="inline-start" />
            Add tags
          </Button>
        )}
        {showDiscardChanges && (
          <Button variant="secondary" size="sm" onClick={onDiscardChanges}>
            <Undo2 data-icon="inline-start" />
            Discard changes
          </Button>
        )}
        {showDiscardDelete && (
          <Button variant="secondary" size="sm" onClick={onDiscardDelete}>
            <RotateCcw data-icon="inline-start" />
            Discard delete
          </Button>
        )}
        {showRestore && (
          <Button variant="secondary" size="sm" onClick={onRestore}>
            <RotateCcw data-icon="inline-start" />
            Restore
          </Button>
        )}
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 data-icon="inline-start" />
          Delete
        </Button>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="ml-auto text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
        onClick={onClear}
      >
        <X />
      </Button>
    </div>
  )
}
