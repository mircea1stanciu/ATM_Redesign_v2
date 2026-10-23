'use client'

interface Capability {
  icon: string
  title: string
  description: string
}

interface SidebarProps {
  capabilities: Capability[]
  communityName?: string
}

export default function Sidebar({ capabilities, communityName }: SidebarProps) {
  return (
    <aside className="w-72 bg-gray-50 dark:bg-surface-800 border-r border-gray-200 dark:border-gray-700 p-6 overflow-y-auto">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        🎯 What I Can Do
        {communityName && (
          <span className="block text-sm font-normal text-gray-600 dark:text-gray-400 mt-1">
            {communityName}
          </span>
        )}
      </h3>
      
      <ul className="space-y-3">
        {capabilities.map((capability, index) => (
          <li
            key={index}
            className="flex items-start space-x-3 p-3 bg-white dark:bg-surface-900 border border-gray-200 dark:border-gray-600 rounded-lg"
          >
            <span className="text-2xl flex-shrink-0">{capability.icon}</span>
            <div>
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                {capability.title}
              </h4>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                {capability.description}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  )
}
