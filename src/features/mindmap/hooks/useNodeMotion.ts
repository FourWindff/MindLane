import { useEffect, useState, type CSSProperties } from 'react'

/**
 * View-layer hooks for the agent write-path animation: prefers-reduced-motion
 * detection and the move glide transition. Pure presentation (never touches the
 * editor or history); kept in a separate file from the particle components so
 * each file exports only hooks or only components (react-refresh rule).
 */

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

interface GlideData {
  gliding?: boolean
  glideFrom?: { x: number; y: number }
}

/**
 * Glide transition: after moveSubtree the positions change on the next render,
 * so on the change frame the content is first placed at the old position
 * (glideFrom) and dropped back to the real position on the following frame —
 * the CSS transition interpolates the in-between. Returns the offset style to
 * merge into the node root element; null when not gliding / reduced motion.
 */
export function useNodeGlide(
  data: GlideData,
  xPos: number,
  yPos: number,
  reduced: boolean,
): CSSProperties | null {
  const dx = (data.glideFrom?.x ?? xPos) - xPos
  const dy = (data.glideFrom?.y ?? yPos) - yPos
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  useEffect(() => {
    if (!data.gliding || reduced || (dx === 0 && dy === 0)) return
    setOffset({ x: dx, y: dy })
    const raf = requestAnimationFrame(() => setOffset({ x: 0, y: 0 }))
    return () => cancelAnimationFrame(raf)
  }, [data.gliding, dx, dy, reduced])
  if (!data.gliding || reduced) return null
  return {
    transform: `translate(${offset.x}px, ${offset.y}px)`,
    transition: 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
    willChange: 'transform',
  }
}
