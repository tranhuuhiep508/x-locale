import { createFileRoute } from '@tanstack/react-router'
import { Layers, LogIn } from 'lucide-react'
import { Button } from '../components/ui'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="h-8 w-8 text-brand-600" />
            <span className="text-2xl font-bold text-slate-900">TMS</span>
          </div>
          <p className="text-slate-500 text-sm">Translation Management System</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8">
          <h1 className="text-lg font-semibold text-slate-900 mb-1">Sign in</h1>
          <p className="text-sm text-slate-500 mb-6">
            Sign in to manage your translation projects.
          </p>

          <a href="/api/auth/login" className="block w-full">
            <Button className="w-full" size="lg">
              <LogIn className="h-4 w-4" />
              Continue with SSO
            </Button>
          </a>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Secure authentication via your organization's identity provider.
        </p>
      </div>
    </div>
  )
}
