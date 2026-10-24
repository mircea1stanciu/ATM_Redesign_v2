import type { ReactNode } from 'react'
import * as RadixMenu from '@radix-ui/react-dropdown-menu'
import { cn } from './cn'

export function DropdownMenu({ trigger, children, align = 'end' }: {
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'center' | 'end'
}) {
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align={align}
          sideOffset={6}
          className="z-[60] min-w-[200px] rounded-xl border border-line bg-surface p-1 shadow-float animate-scale-in"
        >
          {children}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  )
}

export function MenuItem({ children, onSelect, icon, danger }: {
  children: ReactNode
  onSelect: () => void
  icon?: ReactNode
  danger?: boolean
}) {
  return (
    <RadixMenu.Item
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] outline-none',
        'data-[highlighted]:bg-surface-2',
        danger ? 'text-danger' : 'text-fg',
      )}
    >
      {icon}
      {children}
    </RadixMenu.Item>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <RadixMenu.Label className="px-2.5 py-2">{children}</RadixMenu.Label>
}

export function MenuSeparator() {
  return <RadixMenu.Separator className="my-1 h-px bg-line" />
}
