import { useEffect, useRef, useState } from 'react'

type Props = {
  dateFrom: string
  setDateFrom: (v: string) => void
  dateTo: string
  setDateTo: (v: string) => void
  collectionFilter: string[]
  setCollectionFilter: (v: string[]) => void
  sourceFilter: Array<'local' | 'github_actions'>
  setSourceFilter: (v: Array<'local' | 'github_actions'>) => void
  collectionOptions: string[]
  environmentFilter: string[]
  setEnvironmentFilter: (v: string[]) => void
  environmentOptions: string[]
  executionTimeFilter: string[]
  setExecutionTimeFilter: (v: string[]) => void
  executionTimeOptions: string[]
  hasActiveFilters: boolean
  clearFilters: () => void
}

function MultiSelect({
  id,
  label,
  options,
  selected,
  setSelected,
  formatOption = value => value,
  className = '',
  isOpen,
  onOpenChange,
}: {
  id: string
  label: string
  options: string[]
  selected: string[]
  setSelected: (values: string[]) => void
  formatOption?: (value: string) => string
  className?: string
  isOpen: boolean
  onOpenChange: (id: string | null) => void
}) {
  const toggleOption = (value: string) => {
    setSelected(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value])
  }
  const selectionLabel = selected.length === 0 ? label : `${label} (${selected.length})`

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => onOpenChange(isOpen ? null : id)}
        aria-expanded={isOpen}
        className="form-input flex items-center gap-1 !py-1 !px-1.5 !text-[11px] text-gray-600 dark:text-gray-300"
      >
        {selectionLabel}
      </button>
      {isOpen && (
        <div className="absolute right-0 z-30 mt-1 max-h-52 min-w-48 overflow-y-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {options.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-gray-400">No options</p>
          ) : options.map(option => (
            <label key={option} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700">
              <input type="checkbox" checked={selected.includes(option)} onChange={() => toggleOption(option)} />
              <span className="max-w-56 truncate" title={formatOption(option)}>{formatOption(option)}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export function RunFiltersBar({
  dateFrom, setDateFrom, dateTo, setDateTo, collectionFilter, setCollectionFilter,
  sourceFilter, setSourceFilter, collectionOptions, environmentFilter, setEnvironmentFilter, environmentOptions,
  executionTimeFilter, setExecutionTimeFilter, executionTimeOptions, hasActiveFilters, clearFilters,
}: Props) {
  const [openFilterId, setOpenFilterId] = useState<string | null>(null)
  const filterBarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openFilterId) return

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!filterBarRef.current?.contains(event.target as Node)) setOpenFilterId(null)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [openFilterId])

  return (
    <div ref={filterBarRef} className="flex flex-wrap items-center gap-1.5">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpenFilterId(openFilterId === 'dates' ? null : 'dates')}
          aria-expanded={openFilterId === 'dates'}
          className="form-input flex items-center !py-1 !px-1.5 !text-[11px] text-gray-600 dark:text-gray-300"
        >
          Date range
        </button>
        {openFilterId === 'dates' && (
          <div className="absolute left-0 z-30 mt-1 flex min-w-72 items-center gap-1 rounded-md border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              max={dateTo || undefined}
              title="Filter from date"
              className="form-input w-auto !py-1 !px-1.5 !text-[11px]"
            />
            <span className="text-[11px] text-gray-400">–</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              min={dateFrom || undefined}
              title="Filter to date"
              className="form-input w-auto !py-1 !px-1.5 !text-[11px]"
            />
          </div>
        )}
      </div>
      <MultiSelect id="sources" label="Sources" options={['local', 'github_actions']} selected={sourceFilter} setSelected={values => setSourceFilter(values as typeof sourceFilter)} formatOption={source => source === 'local' ? 'Local' : 'GitHub Actions'} isOpen={openFilterId === 'sources'} onOpenChange={setOpenFilterId} />
      <MultiSelect id="collections" label="Collections" options={collectionOptions} selected={collectionFilter} setSelected={setCollectionFilter} isOpen={openFilterId === 'collections'} onOpenChange={setOpenFilterId} />
      <MultiSelect id="environments" label="Environments" options={environmentOptions} selected={environmentFilter} setSelected={setEnvironmentFilter} isOpen={openFilterId === 'environments'} onOpenChange={setOpenFilterId} />
      <MultiSelect id="execution-times" label="Execution times" options={executionTimeOptions} selected={executionTimeFilter} setSelected={setExecutionTimeFilter} formatOption={time => new Date(time).toLocaleString()} isOpen={openFilterId === 'execution-times'} onOpenChange={setOpenFilterId} />
      {hasActiveFilters && (
        <button
          type="button"
          onClick={clearFilters}
          className="text-[11px] text-gray-400 underline hover:text-gray-600 dark:hover:text-gray-300"
        >
          Clear
        </button>
      )}
    </div>
  )
}
