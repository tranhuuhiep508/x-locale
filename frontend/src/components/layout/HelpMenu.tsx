import { CircleHelp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTourControls } from '@/lib/tours/tour-context'

export function HelpMenu() {
  const { canReplay, replay } = useTourControls()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Help" className="size-8">
          <CircleHelp />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem disabled={!canReplay} onSelect={() => replay()}>
          Tour this page
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
