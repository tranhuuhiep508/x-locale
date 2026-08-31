import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'

export function CopyableSecretField({
  value,
  label = 'Secret',
  onCopied,
}: {
  value: string
  label?: string
  onCopied?: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      onCopied?.()
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can fail in insecure contexts or when permission is denied.
    }
  }

  return (
    <InputGroup className="h-auto min-h-8">
      <InputGroupInput
        readOnly
        value={value}
        aria-label={label}
        className="font-mono text-xs"
        onFocus={(e) => e.currentTarget.select()}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="xs"
          onClick={() => void copy()}
          aria-label={copied ? 'Copied' : `Copy ${label}`}
        >
          {copied ? (
            <Check data-icon="inline-start" />
          ) : (
            <Copy data-icon="inline-start" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
