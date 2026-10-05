import { useState } from 'react'
import type { Module, Tag } from '@/lib/api/types'
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to module</DialogTitle>
          <DialogDescription>Choose a module for the selected strings.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground italic"
            disabled={isLoading}
            onClick={() => onSelect(null)}
          >
            — No module —
          </Button>
          {modules.map((m) => (
            <Button
              key={m.id}
              variant="ghost"
              className="h-auto min-h-10 w-full justify-start py-2"
              disabled={isLoading}
              onClick={() => onSelect(m.id)}
            >
              <span className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="max-w-full truncate">{m.name}</span>
                <span className="max-w-full truncate font-mono text-xs text-muted-foreground">
                  {m.slug}
                </span>
              </span>
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add tags</DialogTitle>
          <DialogDescription>Apply tags to all selected strings.</DialogDescription>
        </DialogHeader>
        <FieldGroup className="max-h-64 gap-1 overflow-y-auto">
          {tags.map((t) => (
            <Field
              key={t.id}
              orientation="horizontal"
              className="gap-2 rounded-md px-3 py-2 hover:bg-muted"
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
              <FieldLabel htmlFor={`batch-tag-${t.id}`} className="min-w-0 flex-1 wrap-anywhere">
                <span
                  className="size-3 shrink-0 rounded-full"
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
