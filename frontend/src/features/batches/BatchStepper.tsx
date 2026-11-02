import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const steps = [
  { label: 'Translate', description: 'Project target languages' },
  { label: 'Review', description: 'Check and edit translations' },
  { label: 'Publish', description: 'Save the entire batch' },
]

export function BatchStepper({ current }: { current: number }) {
  return (
    <ol aria-label="Batch progress" className="grid grid-cols-3">
      {steps.map((step, index) => {
        const complete = index < current
        const active = index === current
        return (
          <li
            key={step.label}
            aria-current={active ? 'step' : undefined}
            className="relative flex min-w-0 flex-col items-center gap-3 text-center"
          >
            {index < steps.length - 1 && (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-4 left-[calc(50%+1.25rem)] h-px w-[calc(100%-2.5rem)] bg-border',
                  complete && 'bg-primary'
                )}
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                'flex size-8 items-center justify-center rounded-full border bg-card font-mono text-xs text-muted-foreground',
                active &&
                  'border-primary bg-primary text-primary-foreground ring-4 ring-primary/10',
                complete && 'border-primary bg-primary/10 text-primary'
              )}
            >
              {complete ? <Check className="size-4" /> : index + 1}
            </span>
            <div className="flex flex-col gap-1">
              <span
                className={cn(
                  'text-sm font-medium text-muted-foreground',
                  (active || complete) && 'text-foreground'
                )}
              >
                {step.label}
                <span className="sr-only">
                  {complete ? ', complete' : active ? ', current step' : ', upcoming'}
                </span>
              </span>
              <span className="hidden text-xs text-muted-foreground sm:block">
                {step.description}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
