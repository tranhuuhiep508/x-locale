import { useState } from 'react'
import {
  Layers,
  ShieldCheck,
  ArrowRight,
  Terminal,
  Sparkles,
  Globe,
  FileCode2,
  History,
} from 'lucide-react'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

function MicrosoftLogo({ className = 'size-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 21 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="9" height="9" fill="#F25022" rx="0.5" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" rx="0.5" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" rx="0.5" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" rx="0.5" />
    </svg>
  )
}

interface DemoLocale {
  code: string
  label: string
  flag: string
  translation: string
  context: string
  confidence: number
  status: 'source' | 'public'
  module: string
}

const DEMO_LOCALES: DemoLocale[] = [
  {
    code: 'en-US',
    label: 'English',
    flag: '🇺🇸',
    translation: 'Translate fast, ship globally without broken keys.',
    context: 'Source string',
    confidence: 100,
    status: 'source',
    module: 'auth',
  },
  {
    code: 'vi-VN',
    label: 'Tiếng Việt',
    flag: '🇻🇳',
    translation: 'Dịch nhanh, phát hành toàn cầu không lo lỗi khóa dịch.',
    context: 'Ngữ cảnh chuẩn hóa',
    confidence: 99,
    status: 'public',
    module: 'auth',
  },
  {
    code: 'ja-JP',
    label: '日本語',
    flag: '🇯🇵',
    translation: '迅速に翻訳し、キーの不整合なく世界中へ配信。',
    context: '文脈検証済み',
    confidence: 98,
    status: 'public',
    module: 'auth',
  },
  {
    code: 'de-DE',
    label: 'Deutsch',
    flag: '🇩🇪',
    translation: 'Schnell übersetzen, weltweit ohne defekte Schlüssel ausliefern.',
    context: 'Kontext geprüft',
    confidence: 98,
    status: 'public',
    module: 'auth',
  },
  {
    code: 'es-ES',
    label: 'Español',
    flag: '🇪🇸',
    translation: 'Traduce rápido, distribuye globalmente sin claves rotas.',
    context: 'Contexto verificado',
    confidence: 97,
    status: 'public',
    module: 'auth',
  },
]

export function LoginPage() {
  const [selectedLocaleIndex, setSelectedLocaleIndex] = useState(1) // Default to Tiếng Việt (Vietnamese base in demo)

  const activeLocale = DEMO_LOCALES[selectedLocaleIndex]

  return (
    <div className="relative flex min-h-svh flex-col overflow-x-hidden bg-background text-foreground">
      {/* Ambient atmospheric sky glow backdrop */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        aria-hidden="true"
      >
        <div className="absolute -top-32 left-1/4 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute top-1/3 -right-32 h-80 w-96 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-64 w-[36rem] rounded-full bg-primary/8 blur-3xl" />
        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05]"
          style={{
            backgroundImage: `radial-gradient(currentColor 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }}
        />
      </div>

      {/* Top Application Header */}
      <header className="sky-chrome sticky top-0 z-40 border-b border-border/40">
        <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 shadow-xs">
              <Layers className="size-4 text-primary" />
            </span>
            <span className="text-base font-semibold tracking-tight text-foreground">
              x-locale
            </span>
          </div>

          <ThemeToggle />
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 items-center px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
        <div className="grid w-full gap-6 lg:grid-cols-12 lg:gap-8 xl:gap-12">
          {/* Left Column: Focused Authentication Card */}
          <div className="flex flex-col justify-center lg:col-span-5">
            <div className="mx-auto w-full max-w-md lg:mx-0">
              {/* Eyebrow badge */}
              <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                <ShieldCheck className="size-3.5 text-primary" />
                <span>Translation management</span>
              </div>

              {/* Title & subtitle */}
              <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Welcome to your localization workspace
              </h1>
              <p className="mt-1.5 text-xs text-muted-foreground sm:text-sm">
                Sign in to manage and sync your localization catalogs.
              </p>

              {/* Main Auth Card */}
              <div className="sky-panel relative mt-4 overflow-hidden rounded-2xl border border-border/80 p-5 shadow-md transition-all duration-200 sm:p-6">
                {/* Horizon highlight hairline on top border */}
                <div
                  className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary/60 to-transparent"
                  aria-hidden="true"
                />

                <div className="space-y-4">
                  {/* Primary SSO Button */}
                  <Button
                    className="group relative h-11 w-full justify-between rounded-xl px-4 text-sm font-semibold shadow-xs transition-all duration-200 hover:translate-y-[-1px] hover:shadow-md"
                    size="lg"
                    asChild
                  >
                    <a href="/api/auth/login">
                      <span className="flex items-center gap-3">
                        <span className="flex size-6 items-center justify-center rounded-md bg-white p-1 shadow-2xs">
                          <MicrosoftLogo className="size-4" />
                        </span>
                        <span>Continue with Microsoft</span>
                      </span>
                      <ArrowRight className="size-4 text-primary-foreground/70 transition-transform duration-200 group-hover:translate-x-1" />
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: The Product Showcase & Interactive Localization Lens */}
          <div className="flex flex-col justify-center lg:col-span-7">
            <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
              {/* Product Showcase Card */}
              <div className="sky-panel overflow-hidden rounded-2xl border border-border/80 shadow-xl ring-1 ring-border/40 backdrop-blur-sm">
                {/* Showcase Header Bar */}
                <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <div className="size-2.5 rounded-full bg-red-400/80 dark:bg-red-500/80" />
                      <div className="size-2.5 rounded-full bg-amber-400/80 dark:bg-amber-500/80" />
                      <div className="size-2.5 rounded-full bg-emerald-400/80 dark:bg-emerald-500/80" />
                    </div>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      demo-app <span className="text-border">/</span> <span className="text-foreground">catalog-studio</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[11px] font-normal">
                      stage: public
                    </Badge>
                    <Badge variant="secondary" className="gap-1 font-mono text-[11px]">
                      <Sparkles className="size-3 text-primary" />
                      AI Live
                    </Badge>
                  </div>
                </div>

                {/* Interactive Locale Switcher Tabs */}
                <div className="border-b border-border/60 bg-muted/20 px-4 py-2">
                  <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 sm:pb-0">
                    <div className="flex items-center gap-1.5">
                      <Globe className="size-3.5 text-muted-foreground shrink-0" />
                      <span className="eyebrow shrink-0">Locale:</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {DEMO_LOCALES.map((locale, index) => {
                        const isSelected = selectedLocaleIndex === index
                        return (
                          <button
                            key={locale.code}
                            type="button"
                            onClick={() => setSelectedLocaleIndex(index)}
                            className={cn(
                              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150',
                              isSelected
                                ? 'bg-primary text-primary-foreground shadow-2xs font-semibold'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                            )}
                          >
                            <span>{locale.flag}</span>
                            <span>{locale.label}</span>
                            {locale.status === 'source' && (
                              <span className="ml-0.5 rounded px-1 py-0.2 font-mono text-[9px] bg-primary-foreground/20 text-primary-foreground">
                                src
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* Active String Inspection Canvas */}
                <div className="p-4 sm:p-5 space-y-3">
                  {/* String Key & Metadata row */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <FileCode2 className="size-4 text-primary" />
                      <span className="font-semibold text-foreground">auth.welcome_message</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        module: {activeLocale.module}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        Confidence:
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          'font-mono text-xs font-medium',
                          activeLocale.confidence >= 98
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'bg-primary/10 text-primary',
                        )}
                      >
                        {activeLocale.confidence}%
                      </Badge>
                    </div>
                  </div>

                  {/* Source vs Target Comparison Cards */}
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {/* Source Text Box */}
                    <div className="rounded-xl border border-border/70 bg-card p-3 space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-mono font-medium text-muted-foreground uppercase">
                          Source (en-US)
                        </span>
                        <span className="text-muted-foreground">Base</span>
                      </div>
                      <p className="text-sm font-medium text-foreground">
                        {DEMO_LOCALES[0].translation}
                      </p>
                    </div>

                    {/* Target Translation Box */}
                    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-mono font-semibold text-primary uppercase flex items-center gap-1">
                          <span>{activeLocale.flag}</span>
                          <span>Target ({activeLocale.code})</span>
                        </span>
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary">
                          {activeLocale.status}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-foreground">
                        {activeLocale.translation}
                      </p>
                      <p className="text-[11px] text-primary/80">
                        {activeLocale.context}
                      </p>
                    </div>
                  </div>

                  {/* Terminal CLI Snippet */}
                  <div className="overflow-hidden rounded-xl border border-border/60 bg-haze-950 text-haze-100 dark:bg-black/80 font-mono text-xs shadow-inner">
                    <div className="flex items-center justify-between border-b border-haze-800/60 bg-haze-900/60 px-3 py-1 text-[11px] text-haze-400">
                      <div className="flex items-center gap-1.5">
                        <Terminal className="size-3 text-primary" />
                        <span>terminal // loc cli</span>
                      </div>
                      <span className="text-haze-500">v0.2.0</span>
                    </div>
                    <div className="p-2.5 space-y-1 text-haze-200 text-[11px]">
                      <p className="text-haze-400">
                        <span className="text-emerald-400">$</span> loc push --stage draft
                      </p>
                      <p className="text-emerald-400/90 pl-3">
                        ✓ 3 modules verified • 48 strings synced
                      </p>
                      <p className="text-haze-400">
                        <span className="text-emerald-400">$</span> loc pull --stage public
                      </p>
                      <p className="text-azure-300 pl-3">
                        ✓ Snapshot deployed into ./locales
                      </p>
                    </div>
                  </div>
                </div>

                {/* Core Main Features Suite */}
                <div className="grid grid-cols-2 divide-y divide-border/60 border-t border-border/60 bg-muted/20 sm:grid-cols-4 sm:divide-y-0 sm:divide-x">
                  <div className="p-2.5 flex items-center gap-2">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Sparkles className="size-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">Context-Aware AI</p>
                      <p className="text-[10px] text-muted-foreground truncate">Tone & confidence</p>
                    </div>
                  </div>

                  <div className="p-2.5 flex items-center gap-2">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <ShieldCheck className="size-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">Draft & Public</p>
                      <p className="text-[10px] text-muted-foreground truncate">Zero prod drift</p>
                    </div>
                  </div>

                  <div className="p-2.5 flex items-center gap-2">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-azure-500/10 text-azure-600 dark:text-azure-400">
                      <Terminal className="size-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">CLI & Git Sync</p>
                      <p className="text-[10px] text-muted-foreground truncate">CI/CD automation</p>
                    </div>
                  </div>

                  <div className="p-2.5 flex items-center gap-2">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      <History className="size-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">Audit & Revert</p>
                      <p className="text-[10px] text-muted-foreground truncate">1-click batch undo</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Subtle Footer */}
      <footer className="border-t border-border/40 py-2.5 text-center text-xs text-muted-foreground">
        <p>© {new Date().getFullYear()} x-locale</p>
      </footer>
    </div>
  )
}
