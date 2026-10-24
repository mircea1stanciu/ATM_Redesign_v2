import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from './cn'

const CONTROL =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-fg placeholder:text-fg-muted/70 ' +
  'outline-none transition-colors hover:border-fg-muted/40 focus:border-brand focus:ring-2 focus:ring-brand/25 ' +
  'disabled:opacity-50'

interface FieldProps {
  label: string
  help?: ReactNode
  error?: ReactNode
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode
}

/** Label, help text and error text around a control. */
export function Field({ label, help, error, children }: FieldProps) {
  const id = useId()
  const describedBy = error ? `${id}-error` : help ? `${id}-help` : undefined
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-fg-muted">{label}</label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">{error}</p>
      ) : help ? (
        <p id={`${id}-help`} className="text-xs text-fg-muted">{help}</p>
      ) : null}
    </div>
  )
}

type Labelled = { label: string; help?: ReactNode; error?: ReactNode }

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Labelled>(function Input(
  { label, help, error, className, ...rest }, ref,
) {
  return (
    <Field label={label} help={help} error={error}>
      {props => <input ref={ref} className={cn(CONTROL, className)} {...props} {...rest} />}
    </Field>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & Labelled>(
  function Textarea({ label, help, error, className, ...rest }, ref) {
    return (
      <Field label={label} help={help} error={error}>
        {props => <textarea ref={ref} className={cn(CONTROL, className)} {...props} {...rest} />}
      </Field>
    )
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & Labelled>(
  function Select({ label, help, error, className, children, ...rest }, ref) {
    return (
      <Field label={label} help={help} error={error}>
        {props => <select ref={ref} className={cn(CONTROL, className)} {...props} {...rest}>{children}</select>}
      </Field>
    )
  },
)

export function Checkbox({ label, help, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: ReactNode
  help?: ReactNode
}) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2 text-[13px] text-fg', className)}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" {...rest} />
      <span>
        {label}
        {help && <span className="block text-xs text-fg-muted">{help}</span>}
      </span>
    </label>
  )
}

export function Switch({ label, checked, onChange, disabled }: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-[13px] text-fg">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-accent' : 'bg-line',
        )}
      >
        <span className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )} />
      </button>
    </label>
  )
}
