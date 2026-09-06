const BOOTSTRAP_HANDOFF_KEY = 'ritual:bootstrap-handoff:v1'
const BOOTSTRAP_HANDOFF_MAX_AGE_MS = 30_000

export type BootstrapHandoff = {
  nextRoute?: string
  savedAt: number
}

export function storeBootstrapHandoff(bootstrap: { nextRoute?: unknown }): void {
  if (typeof window === 'undefined') return

  const handoff: BootstrapHandoff = {
    ...(typeof bootstrap.nextRoute === 'string' ? { nextRoute: bootstrap.nextRoute } : {}),
    savedAt: Date.now(),
  }
  window.sessionStorage.setItem(BOOTSTRAP_HANDOFF_KEY, JSON.stringify(handoff))
}

export function consumeBootstrapHandoff(): BootstrapHandoff | null {
  if (typeof window === 'undefined') return null

  const serialized = window.sessionStorage.getItem(BOOTSTRAP_HANDOFF_KEY)
  window.sessionStorage.removeItem(BOOTSTRAP_HANDOFF_KEY)
  if (!serialized) return null

  try {
    const handoff = JSON.parse(serialized) as Partial<BootstrapHandoff>
    if (
      typeof handoff.savedAt !== 'number'
      || Date.now() - handoff.savedAt > BOOTSTRAP_HANDOFF_MAX_AGE_MS
    ) {
      return null
    }
    return {
      ...(typeof handoff.nextRoute === 'string' ? { nextRoute: handoff.nextRoute } : {}),
      savedAt: handoff.savedAt,
    }
  } catch {
    return null
  }
}
