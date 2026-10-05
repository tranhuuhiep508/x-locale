import { AppHeader } from '@/components/layout/AppHeader'

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <AppHeader contained />
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
