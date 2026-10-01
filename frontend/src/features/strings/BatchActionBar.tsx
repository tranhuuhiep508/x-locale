import {
  CheckCircle,
  History,
  MoveRight,
  RotateCcw,
  Tag as TagIcon,
  Trash2,
  Undo2,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import type { BatchAction, Module, Tag } from '@/lib/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { BatchActionSelection } from './batch-selection'

const ACTION_HINT: Record<BatchAction, string> = {
  publish: 'Drafts, changed published strings, and pending removals.',
  unpublish: 'Published strings that have not been deleted.',
  delete: 'Strings that are neither deleted nor already pending removal.',
  discard_changes: 'Published strings with working changes or pending removal.',
  discard_delete: 'Pending removals only. Deleted strings stay deleted.',
  restore: 'Deleted strings only. Pending removals stay queued.',
  restore_last_history: 'Strings that have not been deleted, with a previous edit. Strings without edit history are skipped.',
  move_module: 'All selected strings, including deleted strings.',
  add_tags: 'All selected strings. Existing tags are kept.',
  remove_tags: 'All selected strings.',
}

function SelectionActionButton({
  action,
  label,
  icon: Icon,
  count,
  selectedCount,
  disabled,
  checking,
  variant = 'outline',
  onClick,
}: {
  action: BatchAction
  label: string
  icon: LucideIcon
  count: number
  selectedCount: number
  disabled: boolean
  checking?: boolean
  variant?: 'default' | 'outline' | 'destructive'
  onClick: () => void
}) {
  const approximate = action === 'restore_last_history'
  const countLabel = approximate ? `Up to ${count}` : String(count)
  const description = checking
    ? 'Checking selected strings.'
    : `${countLabel} of ${selectedCount} selected strings. ${ACTION_HINT[action]}`
  return (
    <span className="inline-flex shrink-0" title={description}>
      <Button
        variant={variant}
        size="sm"
        disabled={disabled || count === 0}
        aria-label={label}
        aria-description={description}
        onClick={onClick}
      >
        <Icon data-icon="inline-start" />
        {label}
        <Badge variant="secondary" aria-hidden="true">
          {checking ? '…' : approximate ? `≤ ${count}` : count}
        </Badge>
      </Button>
    </span>
  )
}

export function BatchActionBar({
  selectedCount,
  actions,
  visible,
  pending,
  checking,
  selectionError,
  onRetry,
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
  onRestoreLastEdit,
  onClear,
}: {
  selectedCount: number
  actions: BatchActionSelection
  visible: boolean
  pending?: boolean
  checking?: boolean
  selectionError?: boolean
  onRetry?: () => void
  modules: Module[]
  tags: Tag[]
  onPublish: () => void
  onUnpublish: () => void
  onMove: () => void
  onAddTags: () => void
  onDelete: () => void
  onDiscardChanges: () => void
  onDiscardDelete: () => void
  onRestore: () => void
  onRestoreLastEdit: () => void
  onClear: () => void
}) {
  const open = visible && selectedCount > 0
  const busy = Boolean(pending || checking)
  const disabled = busy || Boolean(selectionError)
  const common = { selectedCount, disabled, checking }
  const showRecovery = actions.discard_changes.length > 0 ||
    actions.discard_delete.length > 0 ||
    actions.restore.length > 0 ||
    actions.restore_last_history.length > 0

  return (
    <div
      role="toolbar"
      aria-label="Batch actions"
      aria-hidden={!open}
      aria-busy={busy}
      inert={!open}
      className={cn(
        'flex max-w-full flex-col gap-1 rounded-lg border border-input bg-popover p-1 text-popover-foreground shadow-sm ring-1 ring-foreground/10 transition-opacity duration-200 ease-drift',
        open ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <div className="flex items-center gap-1 overflow-x-auto">
        <div className="flex shrink-0 items-center gap-2 px-1">
          <Badge>{selectedCount}</Badge>
          <span className="text-sm">selected</span>
          {busy ? <Spinner aria-hidden="true" className="size-3.5 text-muted-foreground" /> : null}
        </div>
        <Separator orientation="vertical" className="mx-0.5 h-5" />
        <SelectionActionButton {...common} action="publish" label="Publish" icon={CheckCircle}
          count={actions.publish.length} variant="default" onClick={onPublish} />
        <SelectionActionButton {...common} action="unpublish" label="Unpublish" icon={XCircle}
          count={actions.unpublish.length} onClick={onUnpublish} />

        {modules.length > 0 || tags.length > 0 ? (
          <Separator orientation="vertical" className="mx-0.5 h-5" />
        ) : null}
        {modules.length > 0 ? (
          <SelectionActionButton {...common} action="move_module" label="Move" icon={MoveRight}
            count={actions.move_module.length} onClick={onMove} />
        ) : null}
        {tags.length > 0 ? (
          <SelectionActionButton {...common} action="add_tags" label="Tags" icon={TagIcon}
            count={actions.add_tags.length} onClick={onAddTags} />
        ) : null}

        {showRecovery ? <Separator orientation="vertical" className="mx-0.5 h-5" /> : null}
        {actions.discard_changes.length > 0 ? (
          <SelectionActionButton {...common} action="discard_changes" label="Discard changes" icon={Undo2}
            count={actions.discard_changes.length} onClick={onDiscardChanges} />
        ) : null}
        {actions.discard_delete.length > 0 ? (
          <SelectionActionButton {...common} action="discard_delete" label="Discard delete" icon={RotateCcw}
            count={actions.discard_delete.length} onClick={onDiscardDelete} />
        ) : null}
        {actions.restore.length > 0 ? (
          <SelectionActionButton {...common} action="restore" label="Restore" icon={RotateCcw}
            count={actions.restore.length} onClick={onRestore} />
        ) : null}
        {actions.restore_last_history.length > 0 ? (
          <SelectionActionButton {...common} action="restore_last_history" label="Restore last edit" icon={History}
            count={actions.restore_last_history.length} onClick={onRestoreLastEdit} />
        ) : null}

        <Separator orientation="vertical" className="mx-0.5 h-5" />
        <SelectionActionButton {...common} action="delete" label="Delete" icon={Trash2}
          count={actions.delete.length} variant="destructive" onClick={onDelete} />
        <Button variant="ghost" size="icon-sm" disabled={pending}
          aria-label="Clear selection" onClick={onClear}>
          <X />
        </Button>
      </div>
      <div className="flex items-center gap-2 px-1">
        <p role="status" className="text-xs text-muted-foreground">
          {selectionError
            ? 'Could not check selected strings. Retry to enable actions.'
            : checking
              ? 'Checking selected strings across pages…'
              : 'Counts show eligible strings. Others are skipped. Hover an action for details.'}
        </p>
        {selectionError && onRetry ? (
          <Button variant="ghost" size="xs" onClick={onRetry}>Retry</Button>
        ) : null}
      </div>
    </div>
  )
}
