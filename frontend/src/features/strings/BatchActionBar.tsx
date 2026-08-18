import { CheckCircle, MoveRight, Tag as TagIcon, Trash2, X, XCircle } from 'lucide-react'
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
  onClear,
}: {
  selectedCount: number
  modules: Module[]
  tags: Tag[]
  onPublish: () => void
  onUnpublish: () => void
  onMove: () => void
  onAddTags: () => void
  onDelete: () => void
  onClear: () => void
}) {
  return (
    <div className="sticky top-[57px] z-10 bg-primary text-primary-foreground px-4 py-2 flex items-center gap-3">
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
