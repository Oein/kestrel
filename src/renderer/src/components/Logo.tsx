// Kestrel brand marks. Same artwork as build/icon.svg (app icon) and resources/trayTemplate*.png.
import { useId } from 'react'

const BEAK = 'M70 30 C77 30 83 35 84.5 42 C85 45 84.6 48 83.2 50.5 C82.6 47.6 81 45.6 78.4 45.2 L71 46 Z'

/** Full-color app icon: kestrel head on the ember tile. */
export function KestrelLogo({ size = 56 }: { size?: number }): React.JSX.Element {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label="Kestrel" role="img">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e2704a" />
          <stop offset="1" stopColor="#c2472b" />
        </linearGradient>
        <clipPath id={`${id}sq`}>
          <rect width="100" height="100" rx="22.5" />
        </clipPath>
      </defs>
      <rect width="100" height="100" rx="22.5" fill={`url(#${id}bg)`} />
      <g clipPath={`url(#${id}sq)`}>
        <g transform="translate(4.85 -4.37) scale(0.971)">
          <path fill="#2b2f36" d={BEAK} />
          <path fill="#fff7f1" d="M23 116 C24 76 25 50 32 37 C38 26 47 21 57 21 C65 21 71 25 74 31 C76 36 76 42 74 47 C73 56 74 66 71 75 C69 88 66 102 62 116 Z" />
          <path fill="#6b7a8a" d="M57 21 C65 21 71 25 74 31 C70 29.6 66 29.4 62 30 C56 31 52.5 34.5 51 40 C48.5 48 41 56 27.6 62 C28 52 29 44 32 37 C38 26 47 21 57 21 Z" />
          <path fill="#f0b23c" d="M71 31.5 C73.5 32 75.5 34 75.6 37 C75.6 39 74.8 40.5 73.6 41.2 C73.4 38 72.5 35 71 31.5 Z" />
          <circle cx="61" cy="37.5" r="5.6" fill="#f0b23c" />
          <circle cx="61" cy="37.5" r="4.2" fill="#22150f" />
          <circle cx="62.5" cy="36" r="1.3" fill="#fff7f1" />
          <path fill="#22150f" d="M57.4 41.6 C59.4 42.6 61.6 42.8 63.2 42 C62.6 49 61 55.5 57.6 61 C56.2 55.5 56.2 48 57.4 41.6 Z" />
        </g>
      </g>
    </svg>
  )
}

/** One-color silhouette (currentColor) for quiet placements, like the menu bar icon. */
export function KestrelGlyph({ size = 24, className }: { size?: number; className?: string }): React.JSX.Element {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="22 18 66 66" className={className} aria-hidden>
      <mask id={`${id}m`}>
        <rect x="0" y="0" width="100" height="100" fill="#fff" />
        <circle cx="60.5" cy="37.5" r="6.4" fill="#000" />
        <path fill="#000" d="M55.6 44 C58.6 45.4 61.6 45.4 64 44.2 C63.4 51 61.2 57.5 57 63 C55.2 57 55 50 55.6 44 Z" />
      </mask>
      <g mask={`url(#${id}m)`} fill="currentColor">
        <path d={BEAK} />
        <path d="M26 84 C26 66 26 50 32 37 C38 26 47 21 57 21 C65 21 71 25 74 31 C76 36 76 42 74 47 C73 56 74 66 71 75 C70 78.5 69 81.5 68 84 Z" />
      </g>
    </svg>
  )
}
