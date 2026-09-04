import { useEffect, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'

/**
 * Particle components for the agent write path: landing bursts and edge-flow
 * dots. Mounted only on cascadeDelay-marked write-path nodes/edges, self-unmount
 * via a timer after the animation, never accumulate. prefers-reduced-motion
 * degradation is passed in from the hooks and gates mounting.
 */

const BURST_DOTS = [
  { x: 22, y: 0 },
  { x: 16, y: 16 },
  { x: 0, y: 22 },
  { x: -16, y: 16 },
  { x: -22, y: 0 },
  { x: -16, y: -16 },
  { x: 0, y: -22 },
  { x: 16, y: -16 },
]

/** Landing burst: an accent-colored cluster erupts from the node center when the node lands. */
export function LandingBurst({ delayMs, reduced }: { delayMs: number; reduced: boolean }) {
  const [gone, setGone] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setGone(true), delayMs + 600)
    return () => clearTimeout(t)
  }, [delayMs])
  if (reduced || gone) return null
  return (
    <div className="node-landing-burst" aria-hidden>
      {BURST_DOTS.map((d, i) => (
        <motion.div
          key={i}
          className="node-landing-burst__dot"
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: d.x, y: d.y, opacity: 0, scale: 0.3 }}
          transition={{ delay: delayMs / 1000, duration: 0.5, ease: 'easeOut' }}
        />
      ))}
    </div>
  )
}

/** Edge-flow dot: as a new edge draws in, an accent dot flows along the path from source to target. */
export function EdgeFlowDot({
  path,
  delayMs,
  reduced,
}: {
  path: string
  delayMs: number
  reduced: boolean
}) {
  const [gone, setGone] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setGone(true), delayMs + 600)
    return () => clearTimeout(t)
  }, [delayMs])
  if (reduced || gone) return null
  return (
    <motion.circle
      r={3}
      fill="var(--ml-accent, #6366f1)"
      style={
        {
          offsetPath: `path('${path}')`,
          pointerEvents: 'none',
        } as CSSProperties
      }
      initial={{ offsetDistance: '0%', opacity: 1 }}
      animate={{ offsetDistance: '100%', opacity: [1, 0.3] }}
      transition={{ delay: delayMs / 1000, duration: 0.5, ease: 'easeIn' }}
    />
  )
}
