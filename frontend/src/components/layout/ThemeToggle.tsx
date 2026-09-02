import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

function readScheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme()
  const [scheme, setScheme] = useState<'light' | 'dark'>(readScheme)

  useEffect(() => {
    if (resolvedTheme === 'light' || resolvedTheme === 'dark') {
      setScheme(resolvedTheme)
    }
  }, [resolvedTheme])

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={scheme}
      onValueChange={(value) => {
        if (value !== 'light' && value !== 'dark') return
        setScheme(value)
        setTheme(value)
      }}
      aria-label="Theme"
      className="bg-background"
    >
      <ToggleGroupItem value="light" aria-label="Light theme">
        <Sun />
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Dark theme">
        <Moon />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
