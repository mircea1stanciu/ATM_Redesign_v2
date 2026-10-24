import { create } from 'zustand'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch {
    return 'system'
  }
}

function resolve(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function apply(preference: ThemePreference) {
  document.documentElement.classList.toggle('dark', resolve(preference) === 'dark')
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // Storage unavailable: the theme still applies for this page.
  }
}

interface ThemeState {
  preference: ThemePreference
  resolved: 'light' | 'dark'
  setPreference: (preference: ThemePreference) => void
  toggle: () => void
}

/** Light, dark or the system setting; remembered on this browser and applied to <html class="dark">. */
export const useTheme = create<ThemeState>((set, get) => ({
  preference: readPreference(),
  resolved: resolve(readPreference()),
  setPreference: preference => {
    apply(preference)
    set({ preference, resolved: resolve(preference) })
  },
  toggle: () => get().setPreference(get().resolved === 'dark' ? 'light' : 'dark'),
}))

/** Applies the saved theme before the first paint, and follows the system while the preference is "system". */
export function initTheme() {
  apply(readPreference())
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { preference, setPreference } = useTheme.getState()
    if (preference === 'system') setPreference('system')
  })
}
