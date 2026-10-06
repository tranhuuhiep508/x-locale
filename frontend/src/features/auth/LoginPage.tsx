import { Layers, LogIn } from 'lucide-react'
import { AppHeader } from '@/components/layout/AppHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function LoginPage() {
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <AppHeader />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center">
            <div className="mb-3 flex items-center gap-2">
              <Layers className="size-8 text-primary" />
              <span className="text-2xl font-semibold tracking-tight text-foreground">
                x-locale
              </span>
            </div>
            <p className="text-sm text-muted-foreground">Translation management</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Sign in</CardTitle>
              <CardDescription>Sign in to manage your translation projects.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" size="lg" asChild>
                <a href="/api/auth/login">
                  <LogIn data-icon="inline-start" />
                  Continue with Microsoft
                </a>
              </Button>
            </CardContent>
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Sign in with a work or personal Microsoft account.
          </p>
        </div>
      </div>
    </div>
  )
}
