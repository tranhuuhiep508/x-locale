import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const steps = [
  { label: 'Translate', description: 'Project target languages' },
  { label: 'Review', description: 'Check and edit translations' },
  { label: 'Publish', description: 'Save the entire batch' },
]

export function BatchStepper({
  current,
  label = 'Batch progress',
}: {
  current: number
  label?: string
}) {
  return (
    <ol
      role="group"
      aria-label={label}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-muted/40 p-1 text-xs"
    >
      {steps.map((step, index) => {
        const complete = index < current
        const active = index === current
        return (
          <li
            key={step.label}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs transition-all duration-300 ease-drift',
              active
                ? 'bg-background text-foreground font-semibold shadow-xs ring-1 ring-border/50 scale-[1.02]'
                : complete
                  ? 'text-primary font-medium hover:text-primary/90'
                  : 'text-muted-foreground'
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex size-3.5 items-center justify-center rounded-full font-mono text-3xs transition-all duration-300 ease-drift',
                active
                  ? 'bg-primary font-semibold text-primary-foreground shadow-xs'
                  : complete
                    ? 'bg-primary/15 text-primary scale-95'
                    : 'bg-muted text-muted-foreground'
              )}
            >
              {complete ? <Check className="size-2.5 stroke-[2.5] animate-in zoom-in-50 duration-200" /> : index + 1}
            </span>
            <span className="font-medium transition-colors duration-200">
              {step.label}
              <span className="sr-only">
                {complete ? ', complete' : active ? ', current step' : ', upcoming'}
              </span>
            </span>
            <span className="sr-only">{step.description}</span>
          </li>
        )
      })}
    </ol>
  )
}
