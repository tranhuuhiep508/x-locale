import { AlertTriangle, Info } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import type { TranslationQAResult } from '@/lib/api/types'
import type { QAStatus } from './use-translation-qa'

export function TranslationQA({ id, result, status = 'checked' }: {
  id: string
  result?: TranslationQAResult | null
  status?: QAStatus
}) {
  if (!result) {
    const text = status === 'checking' ? 'Checking QA…'
      : status === 'unavailable' ? 'QA unavailable. Edit or leave the field to retry.' : 'QA not checked'
    return <p id={id} className="text-xs text-muted-foreground" role="status">{text}</p>
  }
  const errors = result.issues.filter((issue) => issue.severity === 'error')
  return (
    <div id={id} className="flex flex-col gap-2" aria-live="polite">
      {errors.length === 0 && result.complete ? <p className="text-xs text-muted-foreground">No structural issues detected</p> : null}
      {!result.complete ? <p className="text-xs text-muted-foreground">QA checks incomplete</p> : null}
      {result.issues.length > 0 ? (
        <Alert variant={errors.length ? 'destructive' : 'default'} role="status">
          {errors.length ? <AlertTriangle /> : <Info />}
          <AlertTitle>{errors.length ? 'Structural issues' : 'Advisory warnings'}</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {result.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>
                  {issue.severity === 'warning' ? 'Warning: ' : 'Error: '}
                  {issue.side === 'source' ? 'Source: ' : ''}{issue.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

export function TranslationQAIndicator({ result }: { result?: TranslationQAResult | null }) {
  if (!result || (result.issues.length === 0 && result.complete)) return null
  const errors = result.issues.filter((issue) => issue.severity === 'error').length
  const warnings = result.issues.length - errors
  return (
    <details className="text-xs" onClick={(event) => event.stopPropagation()}>
      <summary className="cursor-pointer" aria-label={`QA: ${errors} errors, ${warnings} warnings${result.complete ? '' : ', incomplete'}`}>
        <Badge variant={errors ? 'destructive' : 'outline'}>
          <AlertTriangle aria-hidden="true" /> QA: {result.issues.length}{result.complete ? '' : ' · incomplete'}
        </Badge>
      </summary>
      <ul className="mt-1 flex flex-col gap-1 text-muted-foreground">
        {result.issues.map((issue, index) => <li key={index}>{issue.severity === 'error' ? 'Error' : 'Warning'}{issue.side === 'source' ? ' in source' : ''}: {issue.message}</li>)}
      </ul>
    </details>
  )
}
