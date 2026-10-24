import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from './cn'
import { Tooltip } from './Tooltip'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-brand-fg hover:bg-brand/90',
  secondary: 'border border-line bg-surface text-fg hover:bg-surface-2',
  ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  danger: 'bg-danger text-white hover:bg-danger/90',
}

const SIZES: Record<Size, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-xs',
  md: 'h-9 gap-2 px-3.5 text-[13px]',
}

const BASE = 'inline-flex shrink-0 items-center justify-center rounded-lg font-semibold transition-colors duration-150'

/** Button classes, for links that look like buttons (a link must not wrap a <button>). */
export function buttonStyles(variant: Variant = 'secondary', size: Size = 'md'): string {
  return cn(BASE, VARIANTS[variant], SIZES[size])
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        BASE, 'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant], SIZES[size], className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon'> {
  /** Shown as the tooltip and read by screen readers. */
  label: string
  icon: ReactNode
}

/** An icon-only button; always has a tooltip and an aria-label. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', className, ...rest },
  ref,
) {
  return (
    <Tooltip content={label}>
      <Button
        ref={ref}
        variant={variant}
        size={size}
        aria-label={label}
        className={cn(size === 'sm' ? 'w-7 !px-0' : 'w-9 !px-0', className)}
        icon={icon}
        {...rest}
      />
    </Tooltip>
  )
})
