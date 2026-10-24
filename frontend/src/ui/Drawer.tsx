import type { ReactNode } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

/** The detail panel: slides in from the right, Esc closes it. */
export function Drawer({ open, onOpenChange, title, children, width = 'max-w-xl' }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
  width?: string
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className={`fixed inset-y-0 right-0 z-50 flex w-full ${width} flex-col border-l border-line bg-surface shadow-float animate-slide-in-right`}
        >
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <RadixDialog.Title className="text-[15px] font-semibold text-fg">{title}</RadixDialog.Title>
            <RadixDialog.Close aria-label="Close" className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg">
              <X size={16} />
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
