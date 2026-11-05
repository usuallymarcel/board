import { useSyncExternalStore } from 'react'

const media = window.matchMedia('(min-width: 900px)')

function subscribe(onChange: () => void) {
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export const useIsWide = () => useSyncExternalStore(subscribe, () => media.matches)
