import { useState } from 'react'
import {
  ShieldCheck,
  ArrowRight,
  Terminal,
  Sparkles,
  Globe,
  FileCode2,
  History,
} from 'lucide-react'
import { MeridianMark } from '@/components/layout/AppHeader'
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
    translation: 'Translate fast. Launch easily across markets.',
    context: 'Source string',
    confidence: 100,
    status: 'source',
    module: 'auth',
  },
  {
    code: 'vi-VN',
    label: 'Tiếng Việt',
    flag: '🇻🇳',
    translation: 'Dịch nhanh, dễ dàng ra mắt ở nhiều thị trường.',
    context: 'Ngữ cảnh chuẩn hóa',
    confidence: 99,
    status: 'public',
    module: 'auth',
  },
  {
    code: 'ja-JP',
    label: '日本語',
    flag: '🇯🇵',
    translation: 'すばやく翻訳。さまざまな市場へ簡単にリリース。',
    context: '文脈検証済み',
    confidence: 98,
    status: 'public',
    module: 'auth',
  },
  {
    code: 'de-DE',
    label: 'Deutsch',
    flag: '🇩🇪',
    translation: 'Schnell übersetzen. Einfach in mehreren Märkten starten.',
    context: 'Kontext geprüft',
    confidence: 98,
    status: 'public',
    module: 'auth',
  },
  {
    code: 'es-ES',
    label: 'Español',
    flag: '🇪🇸',
    translation: 'Traduce rápido. Lanza fácilmente en varios mercados.',
    context: 'Contexto verificado',
    confidence: 97,
    status: 'public',
    module: 'auth',
  },
]

export function LoginPage() {
  const [selectedLocaleIndex, setSelectedLocaleIndex] = useState(1)

  const activeLocale = DEMO_LOCALES[selectedLocaleIndex] ?? DEMO_LOCALES[1]

  return (
    <div className="relative flex min-h-svh flex-col overflow-x-hidden bg-background text-foreground">
      {/* Architectural coordinate grid & subtle drifting atmospheric light */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        aria-hidden="true"
      >
        <div className="galley-grid absolute inset-0 opacity-45 dark:opacity-30" />
        <div className="animate-ambient-drift absolute -top-28 left-1/4 h-96 w-[40rem] -translate-x-1/2 rounded-full bg-primary/8 blur-3xl dark:bg-primary/12" />
        <div
          className="animate-ambient-drift absolute bottom-0 right-1/4 h-72 w-[32rem] rounded-full bg-azure-400/8 blur-3xl dark:bg-azure-500/10"
          style={{ animationDelay: '-7s' }}
        />
      </div>

      {/* Top Studio Bar */}
      <header className="sky-chrome sticky top-0 z-40 border-b border-border/60">
        <div className="mx-auto flex h-13 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="group flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md border border-border bg-accent text-accent-foreground shadow-2xs transition-colors group-hover:border-accent-foreground/30">
              <MeridianMark className="size-4" />
            </span>
            <span className="font-heading text-base font-semibold tracking-tight text-foreground">
              x-locale
            </span>
            <span className="hidden rounded border border-border/70 bg-muted/60 px-1.5 py-0.5 font-mono text-3xs text-muted-foreground sm:inline-block">
              EDITION // 0.2
            </span>
          </div>

          <ThemeToggle />
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 items-center px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="grid w-full min-w-0 grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10 xl:gap-12">
          {/* Left Column (Desktop) / Second (Mobile): The Parallel Translation Galley */}
          <div
            className="animate-stage-in order-2 flex min-w-0 flex-col justify-center lg:order-1 lg:col-span-7"
            style={{ '--stagger': 1 } as React.CSSProperties}
          >
            <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
              <div className="sky-panel relative overflow-hidden rounded-xl border border-border/90 shadow-xl transition-shadow duration-300 hover:shadow-2xl">
                {/* Animated Meridian Stream along the top edge */}
                <div
                  className="animate-meridian-stream absolute inset-x-0 top-0 h-0.5"
                  aria-hidden="true"
                />

                {/* Galley Registration Spine */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/45 px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="relative flex size-2" aria-hidden="true">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex size-2 rounded-full bg-primary" />
                    </span>
                    <span className="truncate text-xs font-semibold text-foreground">
                      Live Workspace
                    </span>
                    <span className="text-xs text-muted-foreground">· Interactive preview</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="rounded-md bg-background/60 font-mono text-2xs font-normal">
                      Published
                    </Badge>
                    <Badge variant="secondary" className="gap-1 rounded-md border border-border bg-accent font-mono text-2xs text-accent-foreground">
                      <Sparkles className="size-3 animate-pulse text-accent-foreground" />
                      AI Live
                    </Badge>
                  </div>
                </div>

                {/* Interactive Meridian Locale Strip */}
                <div className="border-b border-border/70 bg-muted/20 px-4 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Globe className="size-3.5 shrink-0 text-primary" />
                      <span className="eyebrow shrink-0">Locale:</span>
                    </div>
                    <div className="flex max-w-full items-center gap-1 overflow-x-auto pb-0.5 sm:pb-0">
                      {DEMO_LOCALES.slice(1).map((locale, offset) => {
                        const index = offset + 1
                        const isSelected = selectedLocaleIndex === index
                        return (
                          <button
                            key={locale.code}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => setSelectedLocaleIndex(index)}
                            className={cn(
                              'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-drift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              isSelected
                                ? '-translate-y-px border-primary bg-primary font-semibold text-primary-foreground shadow-sm'
                                : 'border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted hover:text-foreground',
                            )}
                          >
                            <span>{locale.flag}</span>
                            <span>{locale.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* Parallel String Galley Canvas */}
                <div className="space-y-3.5 p-4 sm:p-5">
                  {/* String Key & Confidence Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 font-mono text-xs">
                      <FileCode2 className="size-4 shrink-0 text-primary" />
                      <span className="truncate font-semibold text-foreground">
                        auth.welcome_message
                      </span>
                      <span className="rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 text-2xs text-muted-foreground">
                        module: {activeLocale.module}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">Confidence:</span>
                      <Badge
                        key={`conf-${activeLocale.code}`}
                        variant="secondary"
                        className="animate-galley-swap rounded-md border border-border bg-accent font-mono text-xs font-semibold text-accent-foreground"
                      >
                        {activeLocale.confidence}%
                      </Badge>
                    </div>
                  </div>

                  {/* Side-by-Side Source -> Target Edition Columns */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {/* Source Galley */}
                    <div className="flex flex-col justify-between rounded-lg border border-border/80 bg-background/60 p-3.5 transition-colors duration-200 hover:border-border">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-2xs">
                          <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                            <span>{DEMO_LOCALES[0].flag}</span>
                            <span>English</span>
                            <span className="font-mono text-3xs uppercase">({DEMO_LOCALES[0].code})</span>
                          </span>
                          <span className="font-mono text-3xs uppercase text-muted-foreground">
                            Source
                          </span>
                        </div>
                        <p className="text-sm font-medium leading-relaxed text-foreground">
                          {DEMO_LOCALES[0].translation}
                        </p>
                      </div>
                      <p className="mt-2 font-mono text-3xs text-muted-foreground">
                        Immutable baseline
                      </p>
                    </div>

                    {/* Target Galley — re-animates smoothly whenever activeLocale changes */}
                    <div
                      key={activeLocale.code}
                      className="animate-galley-swap relative flex flex-col justify-between overflow-hidden rounded-lg border border-primary/40 bg-primary/5 p-3.5 shadow-2xs"
                    >
                      <div
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 w-1 bg-primary"
                      />
                      <div className="space-y-1.5 pl-1">
                        <div className="flex items-center justify-between text-2xs">
                          <span className="flex items-center gap-1 font-mono font-semibold uppercase text-primary">
                            <span>{activeLocale.flag}</span>
                            <span>Target ({activeLocale.code})</span>
                          </span>
                          <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-3xs font-medium uppercase text-accent-foreground">
                            {activeLocale.status}
                          </span>
                        </div>
                        <p className="text-sm font-semibold leading-relaxed text-foreground">
                          {activeLocale.translation}
                        </p>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 pl-1">
                        <p className="font-mono text-2xs text-primary/85">
                          {activeLocale.context}
                        </p>
                        <div
                          aria-hidden="true"
                          className="h-1 w-14 overflow-hidden rounded-full bg-primary/15"
                        >
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-500 ease-drift"
                            style={{ width: `${activeLocale.confidence}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Terminal CLI Sync Ledger */}
                  <div className="overflow-hidden rounded-lg border border-border/70 bg-haze-950 font-mono text-xs text-haze-100 shadow-inner">
                    <div className="flex items-center justify-between border-b border-haze-800/70 bg-haze-900/70 px-3 py-1.5 text-2xs text-haze-400">
                      <div className="flex items-center gap-1.5">
                        <Terminal className="size-3 text-azure-400" />
                        <span>loc-cli // release-pipeline</span>
                      </div>
                      <span className="text-haze-400">v0.2.0</span>
                    </div>
                    <div className="space-y-1 p-3 text-2xs text-haze-200">
                      <p className="text-haze-400">
                        <span className="text-azure-400">$</span> loc push --stage draft
                      </p>
                      <p className="pl-3 text-haze-300">
                        ✓ 3 modules verified · 48 working strings synced
                      </p>
                      <p className="text-haze-400">
                        <span className="text-azure-400">$</span> loc pull --stage public
                      </p>
                      <p className="flex items-center gap-1 pl-3 text-azure-300">
                        <span>✓ Frozen public snapshot written to ./locales</span>
                        <span
                          aria-hidden="true"
                          className="animate-cursor-blink inline-block h-3 w-1.5 bg-azure-400/80"
                        />
                      </p>
                    </div>
                  </div>
                </div>

                {/* Core Capabilities Footer Strip */}
                <div className="grid grid-cols-2 divide-y divide-border/70 border-t border-border/70 bg-muted/25 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
                  <div className="group/feat flex items-center gap-2 p-2.5 transition-colors duration-200 hover:bg-primary/5">
                    <Sparkles className="size-3.5 shrink-0 text-primary transition-transform duration-300 ease-drift group-hover/feat:scale-110 group-hover/feat:rotate-6" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">
                        Context-Aware AI
                      </p>
                      <p className="truncate font-mono text-3xs text-muted-foreground">
                        Tone & confidence
                      </p>
                    </div>
                  </div>

                  <div className="group/feat flex items-center gap-2 p-2.5 transition-colors duration-200 hover:bg-primary/5">
                    <ShieldCheck className="size-3.5 shrink-0 text-primary transition-transform duration-300 ease-drift group-hover/feat:scale-110" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">
                        Draft & Public
                      </p>
                      <p className="truncate font-mono text-3xs text-muted-foreground">
                        Zero prod drift
                      </p>
                    </div>
                  </div>

                  <div className="group/feat flex items-center gap-2 p-2.5 transition-colors duration-200 hover:bg-primary/5">
                    <Terminal className="size-3.5 shrink-0 text-primary transition-transform duration-300 ease-drift group-hover/feat:translate-x-0.5" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">
                        CLI & Git Sync
                      </p>
                      <p className="truncate font-mono text-3xs text-muted-foreground">
                        CI/CD automation
                      </p>
                    </div>
                  </div>

                  <div className="group/feat flex items-center gap-2 p-2.5 transition-colors duration-200 hover:bg-primary/5">
                    <History className="size-3.5 shrink-0 text-primary transition-transform duration-300 ease-drift group-hover/feat:-rotate-12" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">
                        Audit & Revert
                      </p>
                      <p className="truncate font-mono text-3xs text-muted-foreground">
                        1-click batch undo
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column (Desktop) / First (Mobile): Focused Authentication Desk */}
          <div
            className="animate-stage-in order-1 flex min-w-0 flex-col justify-center lg:order-2 lg:col-span-5"
            style={{ '--stagger': 0 } as React.CSSProperties}
          >
            <div className="mx-auto w-full max-w-md lg:mx-0">
              {/* Eyebrow index */}
              <div className="eyebrow mb-2.5 inline-flex items-center gap-2 text-xs text-primary">
                <span aria-hidden="true" className="h-2.5 w-0.5 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
                <span>Translation management</span>
              </div>

              {/* Title & subtitle */}
              <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Welcome to your localization workspace
              </h1>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                Sign in to manage and sync your localization catalogs.
              </p>

              {/* Main Auth Card */}
              <div className="sky-panel relative mt-5 overflow-hidden rounded-xl border border-border/90 p-5 shadow-md transition-all duration-300 ease-drift hover:border-primary/35 hover:shadow-lg sm:p-6">
                <div
                  className="animate-meridian-stream absolute inset-x-0 top-0 h-0.5"
                  aria-hidden="true"
                />

                <div className="space-y-4">
                  {/* Primary SSO Button */}
                  <Button
                    className="group relative h-11 w-full justify-between rounded-lg px-3 text-sm font-semibold shadow-xs transition-all duration-200 ease-drift hover:-translate-y-0.5 hover:shadow-md sm:px-4"
                    size="lg"
                    asChild
                  >
                    <a href="/api/auth/login">
                      <span className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded bg-sun p-1 shadow-2xs transition-transform duration-200 ease-drift group-hover:scale-105">
                          <MicrosoftLogo className="size-4" />
                        </span>
                        <span className="truncate">Continue with Microsoft</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-primary-foreground/80 transition-transform duration-200 ease-drift group-hover:translate-x-1" />
                    </a>
                  </Button>

                  <p className="text-center font-mono text-2xs text-muted-foreground">
                    Single sign-on via Microsoft Entra ID
                  </p>

                  {/* Workflow sequence */}
                  <div className="space-y-2.5 rounded-lg border border-border/70 bg-muted/30 p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="eyebrow text-3xs">How it works</span>
                      <span className="font-mono text-3xs text-muted-foreground">
                        DRAFT → PUBLIC
                      </span>
                    </div>
                    <ol className="space-y-2 text-xs">
                      <li className="group/step flex items-center gap-2.5">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded border border-border bg-accent font-mono text-3xs font-semibold text-accent-foreground transition-transform duration-200 ease-drift group-hover/step:scale-110 group-hover/step:border-accent-foreground/40">
                          1
                        </span>
                        <span className="text-foreground/90 transition-colors group-hover/step:text-foreground">
                          Connect your projects & team members
                        </span>
                      </li>
                      <li className="group/step flex items-center gap-2.5">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded border border-border bg-accent font-mono text-3xs font-semibold text-accent-foreground transition-transform duration-200 ease-drift group-hover/step:scale-110 group-hover/step:border-accent-foreground/40">
                          2
                        </span>
                        <span className="text-foreground/90 transition-colors group-hover/step:text-foreground">
                          Review and polish translations together
                        </span>
                      </li>
                      <li className="group/step flex items-center gap-2.5">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded border border-border bg-accent font-mono text-3xs font-semibold text-accent-foreground transition-transform duration-200 ease-drift group-hover/step:scale-110 group-hover/step:border-accent-foreground/40">
                          3
                        </span>
                        <span className="text-foreground/90 transition-colors group-hover/step:text-foreground">
                          Publish approved copy directly to your apps
                        </span>
                      </li>
                    </ol>
                  </div>

                  {/* Privacy assurance */}
                  <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-2xs text-muted-foreground">
                    <ShieldCheck className="size-3.5 shrink-0 text-primary" />
                    <span>Your workspace data stays private and protected</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 py-2.5 text-center font-mono text-2xs text-muted-foreground">
        <p>© {new Date().getFullYear()} x-locale</p>
      </footer>
    </div>
  )
}
