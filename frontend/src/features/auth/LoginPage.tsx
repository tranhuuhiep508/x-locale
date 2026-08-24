import { Layers, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function LoginPage() {
  return (
    <div className="min-h-screen bg-muted flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold text-foreground">TMS</span>
          </div>
          <p className="text-muted-foreground text-sm">Translation Management System</p>
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

        <p className="text-center text-xs text-muted-foreground mt-6">
          Sign in with a work or personal Microsoft account.
        </p>
      </div>
    </div>
  )
}
