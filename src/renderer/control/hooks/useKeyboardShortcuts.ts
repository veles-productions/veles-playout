/**
 * Centralized keyboard shortcut handling for the playout control window.
 */

import { useEffect } from 'react'

export function useKeyboardShortcuts() {
  useEffect(() => {
    const api = window.playoutAPI
    if (!api) return

    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      switch (e.key) {
        case ' ': // Space = TAKE
        case 'F1':
          e.preventDefault()
          api.take()
          break
        case 'F2': // NEXT
          e.preventDefault()
          api.next()
          break
        case 'Escape': // CLEAR
        case 'F5':
          e.preventDefault()
          api.clear()
          break
        case 'f':
        case 'F':
          if (!e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault()
            api.freeze()
          }
          break
        case 'F12': // PANIC (clear all)
          e.preventDefault()
          api.clear()
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
