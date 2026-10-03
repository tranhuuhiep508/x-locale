import { Button } from '@/components/ui/button'

export function PreviewFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 text-left">
      <p role="alert" className="text-sm text-destructive">
        {error instanceof Error ? error.message : 'Could not load preview.'}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Retry preview
      </Button>
    </div>
  )
}
