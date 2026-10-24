import type { ReactNode } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Button } from './Button'
import { cn } from './cn'

export function Dialog({ open, onOpenChange, title, description, children, footer, className }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-fade-in" />
        <RadixDialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2',
            'flex-col rounded-xl border border-line bg-surface shadow-float data-[state=open]:animate-fade-in',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <RadixDialog.Title className="text-[15px] font-semibold text-fg">{title}</RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="mt-1 text-[13px] text-fg-muted">{description}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close aria-label="Close" className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg">
              <X size={16} />
            </RadixDialog.Close>
          </div>
          {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

/** A confirm dialog that names what is changed or deleted. Replaces window.confirm(). */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, destructive, loading }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  onConfirm: () => void
  destructive?: boolean
  loading?: boolean
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={(
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={destructive ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      )}
    />
  )
}
