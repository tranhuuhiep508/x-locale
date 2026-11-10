import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const steps = [
  { label: 'Translate', description: 'Project target languages' },
  { label: 'Review', description: 'Check and edit translations' },
  { label: 'Publish', description: 'Save the entire batch' },
]

export function BatchStepper({ current }: { current: number }) {
  return (
    <ol
      aria-label="Batch progress"
      className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 p-1 text-xs"
    >
      {steps.map((step, index) => {
        const complete = index < current
        const active = index === current
        return (
          <li
            key={step.label}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-0.5 transition-all text-xs',
              active
                ? 'bg-background text-foreground font-semibold shadow-xs ring-1 ring-border/50'
                : complete
                  ? 'text-primary font-medium'
                  : 'text-muted-foreground/60'
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex size-3.5 items-center justify-center rounded-full text-[9px] font-mono',
                active
                  ? 'bg-primary text-primary-foreground font-bold'
                  : complete
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted text-muted-foreground'
              )}
            >
              {complete ? <Check className="size-2.5 stroke-[2.5]" /> : index + 1}
            </span>
            <span className="font-medium">
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
