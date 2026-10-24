import type { ReactNode } from 'react'
import * as RadixPopover from '@radix-ui/react-popover'
import { cn } from './cn'

export function Popover({ trigger, children, open, onOpenChange, align = 'start', className }: {
  trigger: ReactNode
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
  className?: string
}) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          sideOffset={6}
          className={cn('z-[60] rounded-xl border border-line bg-surface shadow-float animate-scale-in', className)}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
}
