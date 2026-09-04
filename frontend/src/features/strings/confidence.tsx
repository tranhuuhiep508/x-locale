import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export const CONFIDENCE_REVIEW_MAX = 79
export const CONFIDENCE_LOW_MAX = 49

export type ConfidenceTone = 'high' | 'medium' | 'low'

export function confidenceTone(score: number): ConfidenceTone {
  if (score > CONFIDENCE_REVIEW_MAX) return 'high'
  if (score > CONFIDENCE_LOW_MAX) return 'medium'
  return 'low'
}

export function confidenceLabel(score: number): string {
  const tone = confidenceTone(score)
  if (tone === 'high') return `AI confidence ${score} — looks solid`
  if (tone === 'medium') return `AI confidence ${score} — review recommended`
  return `AI confidence ${score} — re-translate if needed`
}

const TONE_CLASS: Record<ConfidenceTone, string> = {
  high: 'text-muted-foreground',
  medium: 'text-amber-700 dark:text-amber-400',
  low: 'text-destructive',
}

export function ConfidenceBadge({
  score,
  className,
}: {
  score: number | null | undefined
  className?: string
}) {
  if (typeof score !== 'number') return null
  const tone = confidenceTone(score)
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex shrink-0 items-center tabular-nums text-[11px] font-medium leading-none',
            TONE_CLASS[tone],
            className,
          )}
          aria-label={confidenceLabel(score)}
        >
          {score}
        </span>
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
