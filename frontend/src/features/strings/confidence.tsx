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

const TONE_STYLE: Record<ConfidenceTone, string> = {
  high:
    'border-emerald-600/25 bg-emerald-600/12 text-emerald-900 dark:border-emerald-400/35 dark:bg-emerald-500/20 dark:text-emerald-200',
  medium:
    'border-amber-600/35 bg-amber-500/15 text-amber-950 dark:border-amber-400/40 dark:bg-amber-500/20 dark:text-amber-200',
  low:
    'border-red-600/35 bg-red-600/12 text-red-900 dark:border-red-400/40 dark:bg-red-500/20 dark:text-red-200',
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
            'inline-flex h-5 w-fit min-w-5 shrink-0 self-start items-center justify-center rounded-md border px-1.5',
            'tabular-nums text-[11px] font-semibold leading-none tracking-tight',
            TONE_STYLE[tone],
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
