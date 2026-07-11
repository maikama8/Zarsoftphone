// Theme preference — light / dark / follow the OS. Stored in localStorage so it
// survives restarts without a DB round-trip. The initial class is applied by an
// inline script in index.html to avoid a flash of the wrong theme.

export type ThemePref = 'system' | 'light' | 'dark'

const KEY = 'theme'

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

export function resolveDark(pref: ThemePref): boolean {
  if (pref === 'dark') return true
  if (pref === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyTheme(pref: ThemePref) {
  localStorage.setItem(KEY, pref)
  document.documentElement.classList.toggle('dark', resolveDark(pref))
}

/** Re-apply on OS theme change while in "system" mode. Returns a cleanup fn. */
export function initThemeListener(): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => {
    if (getThemePref() === 'system') applyTheme('system')
  }
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}
