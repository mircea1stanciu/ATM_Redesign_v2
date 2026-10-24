import type { ReactNode } from 'react'
import { Command } from 'cmdk'
import { Search } from 'lucide-react'

export interface CommandItem {
  id: string
  label: string
  /** Extra words the search matches, for example the area a screen lives in. */
  keywords?: string[]
  icon?: ReactNode
  shortcut?: ReactNode
  onSelect: () => void
}

export interface CommandGroup {
  heading: string
  items: CommandItem[]
}

/** The ⌘K palette: a searchable list of places and actions. */
export function CommandPalette({ open, onOpenChange, groups, placeholder = 'Search or jump to…' }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: CommandGroup[]
  placeholder?: string
}) {
  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      overlayClassName="fixed inset-0 z-[65] bg-black/40"
      contentClassName="fixed left-1/2 top-[15vh] z-[66] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-float animate-fade-in"
    >
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search size={16} className="shrink-0 text-fg-muted" aria-hidden />
        <Command.Input
          placeholder={placeholder}
          className="h-11 w-full bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-muted focus-visible:outline-none"
        />
      </div>
      <Command.List className="max-h-[50vh] overflow-y-auto p-1.5">
        <Command.Empty className="px-3 py-6 text-center text-[13px] text-fg-muted">No results.</Command.Empty>
        {groups.filter(group => group.items.length > 0).map(group => (
          <Command.Group
            key={group.heading}
            heading={group.heading}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-muted"
          >
            {group.items.map(item => (
              <Command.Item
                key={item.id}
                value={`${group.heading} ${item.label} ${item.id}`}
                keywords={item.keywords}
                onSelect={() => { onOpenChange(false); item.onSelect() }}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-fg data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent"
              >
                <span className="flex w-4 shrink-0 justify-center text-fg-muted">{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.shortcut}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command.Dialog>
  )
}
