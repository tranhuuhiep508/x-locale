import { useMutation } from '@tanstack/react-query'
import { Pencil, Trash2, Wand2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { TableCell, TableRow } from '@/components/ui/table'
import { stringsApi } from '@/lib/api/strings'
import type { BatchRequest, StringEntry, Translation } from '@/lib/api/types'
import { useToast } from '@/lib/toast'

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

function TranslationPreview({ translation }: { translation?: Translation }) {
  const value = translation?.value?.trim() ?? ''

  if (!value) {
    return <span className="text-missing-foreground italic text-sm">Missing</span>
  }

  return (
    <p className="text-sm leading-snug line-clamp-2 whitespace-normal wrap-break-word">
      {value}
    </p>
  )
}

interface StringRowProps {
  entry: StringEntry
  projectId: string
  targetLocales: string[]
  selected: boolean
  onToggle: () => void
  onEdit: () => void
  onRefresh: () => void
  onTranslate: () => void
}

export function StringRow({
  entry,
  projectId,
  targetLocales,
  selected,
  onToggle,
  onEdit,
  onRefresh,
  onTranslate,
}: StringRowProps) {
  const toast = useToast()

  const deleteMut = useMutation({
    mutationFn: () => stringsApi.delete(projectId, entry.id),
    onSuccess: () => {
      onRefresh()
      toast.success('String deleted')
    },
    onError: () => toast.error('Failed to delete string'),
  })

  const publishMut = useMutation({
    mutationFn: (publish: boolean) =>
      stringsApi.batch(projectId, {
        action: publish ? 'publish' : 'unpublish',
        string_ids: [entry.id],
      } satisfies BatchRequest),
    onSuccess: (_data, publish) => {
      onRefresh()
      toast.success(publish ? 'Published' : 'Moved to draft')
    },
    onError: () => toast.error('Failed to update status'),
  })

  const translationsByLocale: Record<string, Translation | undefined> = {}
  for (const t of entry.translations) {
    translationsByLocale[t.locale] = t
  }

  const isPublic = entry.status === 'public'

  return (
    <TableRow
      data-state={selected ? 'selected' : undefined}
      className="cursor-pointer group"
      onClick={(e) => {
        const target = e.target as HTMLElement
        if (target.closest('button, input, [role="checkbox"], [role="switch"], a')) return
        onEdit()
      }}
    >
      <TableCell className="align-middle" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onCheckedChange={() => onToggle()} aria-label="Select row" />
      </TableCell>
      <TableCell className="align-middle whitespace-normal max-w-[220px]">
        <div className="space-y-1">
          <span className="font-mono text-xs text-foreground break-all leading-relaxed">
            {entry.key}
          </span>
          {entry.module_slug && (
            <p className="text-[11px] text-muted-foreground font-mono">{entry.module_slug}</p>
          )}
        </div>
      </TableCell>
      <TableCell className="align-middle max-w-[260px] whitespace-normal">
        <p className="text-sm text-foreground leading-relaxed line-clamp-2">{entry.source_text}</p>
        {entry.description ? (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{entry.description}</p>
        ) : null}
      </TableCell>
      {targetLocales.map((locale) => (
        <TableCell key={locale} className="align-middle min-w-[160px] whitespace-normal">
          <TranslationPreview translation={translationsByLocale[locale]} />
        </TableCell>
      ))}
      <TableCell className="align-middle" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <Switch
            size="sm"
            checked={isPublic}
            disabled={publishMut.isPending}
            onCheckedChange={(checked) => publishMut.mutate(checked)}
            aria-label={isPublic ? 'Published' : 'Draft'}
          />
          <span
            className={
              isPublic
                ? 'text-xs font-medium text-public-foreground'
                : 'text-xs text-draft-foreground'
            }
          >
            {publishMut.isPending ? '…' : isPublic ? 'Public' : 'Draft'}
          </span>
        </div>
      </TableCell>
      <TableCell className="align-middle whitespace-normal">
        {entry.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {entry.tags.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: t.color + '22', color: t.color }}
              >
                {t.name}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="align-middle text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-0.5 opacity-70 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Edit"
            onClick={onEdit}
            className="text-muted-foreground hover:text-foreground"
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="AI Translate"
            onClick={onTranslate}
            className="text-muted-foreground hover:text-primary"
          >
            <Wand2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Delete"
            onClick={() => deleteMut.mutate()}
            disabled={deleteMut.isPending}
            className="text-muted-foreground hover:text-destructive"
          >
            {deleteMut.isPending ? <Spinner /> : <Trash2 />}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}
