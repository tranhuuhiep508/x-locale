import { useState } from 'react'
import type { Module, Tag } from '@/lib/api/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
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
    <Dialog open={open} onOpenChange={(next) => { if (!next && !isLoading) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to module</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground italic"
            onClick={() => onSelect(null)}
          >
            — No module —
          </Button>
          {modules.map((m) => (
            <Button
              key={m.id}
              variant="ghost"
              className="w-full justify-start"
              onClick={() => onSelect(m.id)}
            >
              <span className="font-mono text-xs text-muted-foreground mr-2">{m.slug}</span>
              {m.name}
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
    <Dialog open={open} onOpenChange={(next) => { if (!next && !isLoading) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add tags</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
          {tags.map((t) => (
            <label
              key={t.id}
              className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-muted cursor-pointer"
            >
              <Checkbox
                checked={selected.includes(t.id)}
                onCheckedChange={(checked) =>
                  setSelected((prev) =>
                    checked ? [...prev, t.id] : prev.filter((id) => id !== t.id),
                  )
                }
              />
              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: t.color }}
              />
              <span className="text-sm">{t.name}</span>
            </label>
          ))}
        </div>
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
