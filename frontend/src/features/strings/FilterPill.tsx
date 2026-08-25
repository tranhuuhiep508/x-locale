import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

export function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1">
      {label}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        className="size-4 text-muted-foreground hover:text-destructive"
        aria-label={`Remove ${label} filter`}
      >
        <X />
      </Button>
    </Badge>
  )
}
