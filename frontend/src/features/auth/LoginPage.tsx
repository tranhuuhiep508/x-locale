import { Layers, LogIn } from 'lucide-react'
import { AppHeader } from '@/components/layout/AppHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function LoginPage() {
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-muted">
      <AppHeader />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center">
            <div className="mb-3 flex items-center gap-2">
              <Layers className="size-8 text-primary" />
              <span className="text-2xl font-bold text-foreground">TMS</span>
            </div>
            <p className="text-sm text-muted-foreground">Translation Management System</p>
          </div>

          <Card className="p-4">
            <CardHeader>
              <CardTitle className="text-lg">Sign in</CardTitle>
              <CardDescription>
                Sign in to manage your translation projects.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <a href="/api/auth/login" className="block w-full">
                <Button className="w-full" size="lg">
                  <LogIn data-icon="inline-start" />
                  Continue with Microsoft
                </Button>
              </a>
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
