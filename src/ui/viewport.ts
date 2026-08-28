export function bindVisualViewport(): void {
  const viewport = window.visualViewport
  const apply = () => {
    const height = viewport?.height ?? window.innerHeight
    document.documentElement.style.setProperty('--app-h', `${Math.round(height)}px`)
  }
  apply()
  viewport?.addEventListener('resize', apply, { passive: true })
  viewport?.addEventListener('scroll', apply, { passive: true })
  window.addEventListener('orientationchange', apply, { passive: true })
}
