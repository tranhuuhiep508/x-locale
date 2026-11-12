import { useState } from 'react'
import { FolderGit2, FolderX } from 'lucide-react'
import type { Module, Tag } from '@/lib/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'

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
              <span className="flex min-w-0 items-center gap-2.5">
                <FolderGit2 className="size-4 shrink-0 text-primary/80" />
                <span className="max-w-full truncate font-medium">{m.name}</span>
              </span>
              <Badge variant="secondary" className="shrink-0 font-mono text-[11px] font-normal">
                {m.slug}
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
  onApply: (tagIds: string[]) => void
  isLoading: boolean
}) {
  const [selected, setSelected] = useState<string[]>([])

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
            <DialogTitle>Add tags</DialogTitle>
            {selected.length > 0 ? (
              <Badge variant="secondary" className="font-mono text-xs tabular-nums">
                {selected.length} selected
              </Badge>
            ) : null}
          </div>
          <DialogDescription>Apply tags to all selected strings. Existing tags are kept.</DialogDescription>
        </DialogHeader>
        <FieldGroup className="max-h-72 gap-1.5 overflow-y-auto pr-0.5">
          {tags.map((t) => (
            <Field
              key={t.id}
              orientation="horizontal"
              className="gap-2.5 rounded-xl border border-border/70 bg-card/70 px-3.5 py-2.5 transition-colors hover:bg-accent/40 has-data-[state=checked]:border-primary/45 has-data-[state=checked]:bg-primary/5"
            >
              <Checkbox
                id={`batch-tag-${t.id}`}
                disabled={isLoading}
                checked={selected.includes(t.id)}
                onCheckedChange={(checked) =>
                  setSelected((prev) =>
                    checked ? [...prev, t.id] : prev.filter((id) => id !== t.id)
                  )
                }
              />
              <FieldLabel htmlFor={`batch-tag-${t.id}`} className="min-w-0 flex-1 cursor-pointer wrap-anywhere">
                <span
                  className="size-3 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15"
                  style={{ backgroundColor: t.color }}
                />
                {t.name}
              </FieldLabel>
            </Field>
          ))}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={() => onApply(selected)} disabled={selected.length === 0 || isLoading}>
            {isLoading && <Spinner data-icon="inline-start" />}
            Add tags
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
