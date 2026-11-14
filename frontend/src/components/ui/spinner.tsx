import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon data-slot="spinner" role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

/** Keeps a button's label width fixed while overlaying a centered spinner. */
function PendingLabel({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <span className="relative inline-flex items-center justify-center">
      <span className={cn("inline-flex items-center gap-1.5", pending && "opacity-0")}>{children}</span>
      {pending ? (
        <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
          <Spinner aria-hidden="true" className="size-3.5" />
        </span>
      ) : null}
    </span>
  )
}

export { Spinner, PendingLabel }
