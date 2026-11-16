import { useState } from 'react'
import { FolderGit2, FolderX } from 'lucide-react'
import type { Module, Tag } from '@/lib/api/types'
import { tagSwatchColor } from '@/features/strings/catalog-create'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PendingLabel } from '@/components/ui/spinner'

export function BatchMoveDialog({
  open,
  onClose,
  modules,
  onSelect,
  isLoading,
}: {
  open: boolean
  onClose: () => void
  modules: Module[]
  onSelect: (moduleId: string | null) => void
  isLoading: boolean
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isLoading) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move to module</DialogTitle>
          <DialogDescription>Choose a target module for the selected strings.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-0.5">
          <Button
            variant="outline"
            className="h-auto min-h-10 w-full justify-start gap-2.5 border-dashed border-border/80 bg-muted/20 px-3.5 py-2.5 text-muted-foreground italic hover:border-border hover:bg-muted/50 hover:text-foreground"
            disabled={isLoading}
            onClick={() => onSelect(null)}
          >
            <FolderX className="size-4 shrink-0 text-muted-foreground" />
            — No module —
          </Button>
          {modules.map((m) => (
            <Button
              key={m.id}
              variant="outline"
              className="h-auto min-h-11 w-full justify-between gap-3 border-border/70 bg-card/70 px-3.5 py-2.5 hover:border-primary/40 hover:bg-accent/50"
              disabled={isLoading}
              onClick={() => onSelect(m.id)}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2.5">
                <FolderGit2 className="size-4 shrink-0 text-primary" />
                <span className="truncate font-medium">{m.name}</span>
              </span>
              <Badge
                variant="secondary"
                className="max-w-[45%] shrink-0 font-mono text-2xs font-normal"
                title={m.slug}
              >
                <span className="truncate">{m.slug}</span>
              </Badge>
            </Button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function BatchTagDialog({
  open,
  onClose,
  tags,
  onApply,
  isLoading,
}: {
  open: boolean
  onClose: () => void
  tags: Tag[]
  onApply: (tagId: string) => void
  isLoading: boolean
}) {
  const [selected, setSelected] = useState('')

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isLoading) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>Set tag</DialogTitle>
          </div>
          <DialogDescription>Choose one tag for all selected strings. Existing tags will be replaced.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-0.5" role="group" aria-label="Choose tag">
          {tags.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={isLoading}
              aria-pressed={selected === t.id}
              onClick={() => setSelected(t.id)}
              className="focus-ring flex items-center gap-2.5 rounded-xl border border-border/70 bg-card/70 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/40 aria-pressed:border-primary/45 aria-pressed:bg-primary/5"
            >
              <span className="size-3 shrink-0 rounded-full ring-1 ring-foreground/15" style={{ backgroundColor: tagSwatchColor(t.color) }} />
              <span className="min-w-0 flex-1 wrap-anywhere">{t.name}</span>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={() => onApply(selected)} disabled={!selected || isLoading}>
            <PendingLabel pending={isLoading}>Set tag</PendingLabel>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
