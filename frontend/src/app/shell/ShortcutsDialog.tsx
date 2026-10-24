import { AREAS } from '@/app/navigation'
import { Dialog, Kbd } from '@/ui'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export default function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const rows: Array<[React.ReactNode, string]> = [
    [<><Kbd>{IS_MAC ? '⌘' : 'Ctrl'}</Kbd><Kbd>K</Kbd></>, 'Open the command palette'],
    ...AREAS.filter(area => area.shortcut).map(area => [
      <><Kbd>G</Kbd><Kbd>{area.shortcut!.toUpperCase()}</Kbd></>, `Go to ${area.label}`,
    ] as [React.ReactNode, string]),
    [<Kbd>/</Kbd>, 'Search the current list'],
    [<Kbd>?</Kbd>, 'Show this list'],
    [<Kbd>Esc</Kbd>, 'Close a panel or dialog'],
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts">
      <dl className="space-y-2">
        {rows.map(([keys, action]) => (
          <div key={action} className="flex items-center justify-between gap-4 text-[13px]">
            <dt className="text-fg">{action}</dt>
            <dd className="flex gap-1">{keys}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}
