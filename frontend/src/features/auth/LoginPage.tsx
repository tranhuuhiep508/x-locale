import { LogIn } from 'lucide-react'
import { GuestHeader } from '@/components/layout/AppHeader'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { Wordmark } from '@/components/brand/Wordmark'
import { Button } from '@/components/ui/button'
import { localeDir } from '@/lib/locale'

const EXCHANGE_LINES = [
  { code: 'vi', source: 'Bản nháp', target: 'Draft' },
  { code: 'ja', source: '公開する', target: 'Publish' },
  { code: 'de', source: 'Zeichenkette', target: 'String' },
  { code: 'ar', source: 'مفتاح', target: 'Key' },
  { code: 'ko', source: '번역', target: 'Translation' },
  { code: 'zh', source: '模块', target: 'Module' },
] as const

export function LoginPage() {
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background lg:flex-row">
      <aside className="relative hidden min-h-0 flex-col justify-between border-r border-ink-800 bg-ink-900 px-10 py-10 text-ink-50 lg:flex lg:w-[46%] lg:max-w-xl">
        <div
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            background:
              'radial-gradient(80% 50% at 0% 100%, color-mix(in oklch, var(--color-lagoon-600) 28%, transparent), transparent 70%)',
          }}
        />
        <Wordmark
          className="relative text-ink-50"
          markClassName="size-8"
          wordClassName="text-xl text-ink-50"
        />
        <div className="relative flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <p className="eyebrow text-lagoon-300">Source × target</p>
            <h1 className="font-heading text-4xl leading-tight font-medium tracking-tight text-balance">
              Source and target, side by side.
            </h1>
            <p className="text-sm text-ink-300">Translation management</p>
          </div>
          <ul className="flex flex-col gap-3 border-t border-ink-700 pt-6">
            {EXCHANGE_LINES.map((line) => (
              <li
                key={line.code}
                className="grid grid-cols-[2.25rem_1fr_auto] items-baseline gap-3 text-sm"
              >
                <span className="font-mono text-[0.65rem] tracking-wide text-lagoon-300 uppercase">
                  {line.code}
                </span>
                <span lang={line.code} dir={localeDir(line.code)}>
                  {line.source}
                </span>
                <span className="font-mono text-ink-400">{line.target}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative font-mono text-[0.65rem] tracking-wide text-ink-400 uppercase">
          Draft stays draft until you publish
        </p>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <GuestHeader />
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10">
          <div className="absolute top-4 right-5 hidden lg:block">
            <ThemeToggle />
          </div>
          <div className="flex w-full max-w-sm flex-col gap-8">
            <div className="flex flex-col gap-2 lg:gap-3">
              <p className="eyebrow">Sign in</p>
              <h2 className="font-heading text-3xl leading-tight font-medium tracking-tight">
                Open the catalog
              </h2>
              <p className="text-sm text-muted-foreground">
                Sign in to manage your translation projects.
              </p>
            </div>

            <a href="/api/auth/login" className="block w-full">
              <Button className="w-full" size="lg">
                <LogIn data-icon="inline-start" />
                Continue with Microsoft
              </Button>
            </a>

            <p className="text-xs text-muted-foreground">
              Sign in with a work or personal Microsoft account.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
