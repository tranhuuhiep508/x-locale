import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

export const CONFIDENCE_REVIEW_MAX = 79
export const CONFIDENCE_LOW_MAX = 49

export function confidenceLabel(score: number): string {
  return `AI estimate ${score}. Model-reported confidence; heuristic, not verified.`
}

export function ConfidenceBadge({
  score,
  className,
}: {
  score: number | null | undefined
  className?: string
}) {
  if (typeof score !== 'number') return null
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            'inline-flex h-5 w-fit min-w-5 shrink-0 self-start items-center justify-center rounded-md border px-1.5',
            'tabular-nums text-[11px] font-semibold leading-none tracking-tight',
            className,
          )}
          aria-label={confidenceLabel(score)}
        >
          AI estimate {score}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{confidenceLabel(score)}</TooltipContent>
    </Tooltip>
  )
}

export function dropScore(
  scores: Record<string, number>,
  locale: string,
): Record<string, number> {
  if (!(locale in scores)) return scores
  const next = { ...scores }
  delete next[locale]
  return next
}

export function mergeScores(
  prev: Record<string, number>,
  incoming: Record<string, number> | undefined,
  previousTexts: Record<string, string>,
  incomingTexts: Record<string, string>,
  overwrite: boolean,
): Record<string, number> {
  const next = { ...prev }
  for (const [locale, value] of Object.entries(incomingTexts)) {
    if (!value.trim()) continue
    if (!overwrite && previousTexts[locale]?.trim()) continue
    const score = incoming?.[locale]
    if (typeof score === 'number') next[locale] = score
    else delete next[locale]
  }
  return next
}
