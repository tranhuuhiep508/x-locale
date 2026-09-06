import type { Language } from '@/lib/api/types'
import { languageOf, localeDir } from '@/lib/locale'
import { cn } from '@/lib/utils'

export function LocaleChip({
  code,
  languages = [],
  variant = 'outline',
  showCode = true,
  className,
}: {
  code: string
  languages?: Language[]
  variant?: 'outline' | 'base' | 'plain'
  showCode?: boolean
  className?: string
}) {
  const language = languageOf(languages, code)
  const dir = localeDir(code)

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs leading-none',
        variant === 'outline' && 'border border-border bg-card text-foreground',
        variant === 'base' &&
          'border border-lagoon-200 bg-lagoon-50 text-lagoon-800 dark:border-lagoon-800 dark:bg-lagoon-950 dark:text-lagoon-200',
        variant === 'plain' && 'px-0 text-foreground',
        className,
      )}
    >
      <span lang={code} dir={dir} className="truncate">
        {language.native}
      </span>
      {showCode ? (
        <span className="font-mono text-[0.65rem] tracking-wide text-muted-foreground uppercase">
          {language.code}
        </span>
      ) : null}
    </span>
  )
}

export function LocalePair({
  base,
  targets,
  languages = [],
  maxTargets = 3,
  className,
}: {
  base: string
  targets: string[]
  languages?: Language[]
  maxTargets?: number
  className?: string
}) {
  const extra = Math.max(0, targets.length - maxTargets)
  const shown = targets.slice(0, maxTargets)

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <LocaleChip code={base} languages={languages} variant="base" />
      {shown.length > 0 ? (
        <span className="font-mono text-[0.65rem] text-muted-foreground" aria-hidden>
          →
        </span>
      ) : null}
      {shown.map((code) => (
        <LocaleChip key={code} code={code} languages={languages} />
      ))}
      {extra > 0 ? (
        <span className="font-mono text-[0.65rem] text-muted-foreground">+{extra}</span>
      ) : null}
    </div>
  )
}

export function LanguageName({
  language,
  className,
}: {
  language: Language
  className?: string
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-baseline gap-1.5', className)}>
      <span lang={language.code} dir={localeDir(language.code)} className="truncate">
        {language.native}
      </span>
      <span className="shrink-0 font-mono text-[0.65rem] tracking-wide text-muted-foreground uppercase">
        {language.code}
      </span>
    </span>
  )
}
