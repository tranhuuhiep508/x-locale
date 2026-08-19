import { Link } from '@tanstack/react-router'
import { Layers } from 'lucide-react'
import { UserMenu } from '@/components/layout/UserMenu'

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-muted">
      <header className="horizon-b sticky top-0 z-30 flex h-14 items-center gap-4 bg-background px-4">
        <Link to="/" className="flex items-center gap-2 font-semibold text-foreground hover:text-primary">
          <Layers className="size-5 text-primary" />
          TMS
        </Link>
        <div className="flex-1" />
        <UserMenu />
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
