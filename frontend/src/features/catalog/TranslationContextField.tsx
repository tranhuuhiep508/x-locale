import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'

type Props = {
  id: string
  value: string
  onChange: (value: string) => void
  error?: string
}

export function TranslationContextField({ id, value, onChange, error }: Props) {
  return (
    <Field data-invalid={error ? 'true' : undefined}>
      <FieldLabel htmlFor={id}>Translation context (optional)</FieldLabel>
      <Textarea
        id={id}
        value={value}
        maxLength={500}
        placeholder="Use a friendly tone. Keep product names in English."
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${id}_help ${id}_count${error ? ` ${id}_error` : ''}`}
        aria-invalid={error ? true : undefined}
      />
      <FieldDescription id={`${id}_help`}>
        Guide AI tone, terminology, and wording for these strings.
      </FieldDescription>
      <FieldDescription id={`${id}_count`}>{value.length}/500 characters</FieldDescription>
      <FieldError id={`${id}_error`}>{error}</FieldError>
    </Field>
  )
}
