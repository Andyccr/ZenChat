import type { ResolvedTheme, ThemePreference } from '../core/types'

const KEY = 'zenchat.theme'

export function loadThemePreference(): ThemePreference {
  const stored = localStorage.getItem(KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

export function persistThemePreference(pref: ThemePreference): void {
  localStorage.setItem(KEY, pref)
}

export function cycleTheme(pref: ThemePreference): ThemePreference {
  if (pref === 'system') return 'light'
  if (pref === 'light') return 'dark'
  return 'system'
}

export function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(pref: ThemePreference, systemDark = systemPrefersDark()): ResolvedTheme {
  if (pref === 'system') return systemDark ? 'dark' : 'light'
  return pref
}

export function applyTheme(pref: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(pref)
  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.themePref = pref
  document.documentElement.style.colorScheme = resolved
  return resolved
}

export function themeLabel(pref: ThemePreference): string {
  if (pref === 'light') return '白天'
  if (pref === 'dark') return '黑夜'
  return '跟随系统'
}
