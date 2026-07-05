import { useEffect, useCallback, useRef, useState, useMemo } from 'react'
import type { PalaceNodeData, PalaceStation } from '@/shared/lib/fileFormat'

interface PalaceModalProps {
  data: PalaceNodeData
  onClose: () => void
}

function StationPin({ station, active }: { station: PalaceStation; active: boolean }) {
  return (
    <div
      className={`palace-modal__pin${active ? ' palace-modal__pin--active' : ''}`}
      style={{ left: `${station.x * 100}%`, top: `${station.y * 100}%` }}
    >
      {station.order}
    </div>
  )
}

function buildPathD(stations: PalaceStation[]): string {
  if (stations.length === 0) return ''
  const pts = stations.map((s) => ({ x: s.x * 100, y: s.y * 100 }))
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const cur = pts[i]
    const cpx1 = prev.x + (cur.x - prev.x) * 0.4
    const cpx2 = prev.x + (cur.x - prev.x) * 0.6
    d += ` C ${cpx1} ${prev.y}, ${cpx2} ${cur.y}, ${cur.x} ${cur.y}`
  }
  return d
}

export function PalaceModal({ data, onClose }: PalaceModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const stations = useMemo(
    () => [...(data.stations ?? [])].sort((a, b) => a.order - b.order),
    [data.stations],
  )
  const [trailPlaying, setTrailPlaying] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose],
  )

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  const onOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose()
    },
    [onClose],
  )

  const pathD = useMemo(() => buildPathD(stations), [stations])

  const playTrail = useCallback(() => {
    if (trailPlaying || stations.length < 2) return
    setTrailPlaying(true)
    setActiveIdx(0)

    const pathEl = pathRef.current
    if (pathEl) {
      const len = pathEl.getTotalLength()
      pathEl.style.strokeDasharray = `${len}`
      pathEl.style.strokeDashoffset = `${len}`
      pathEl.getBoundingClientRect()
      pathEl.style.transition = `stroke-dashoffset ${stations.length * 0.6}s ease-in-out`
      pathEl.style.strokeDashoffset = '0'
    }

    const interval = (stations.length * 0.6 * 1000) / stations.length
    let i = 0
    const timer = setInterval(() => {
      i++
      if (i >= stations.length) {
        clearInterval(timer)
        setTimeout(() => {
          setTrailPlaying(false)
          setActiveIdx(-1)
          if (pathEl) {
            pathEl.style.transition = 'none'
            const len = pathEl.getTotalLength()
            pathEl.style.strokeDashoffset = `${len}`
          }
        }, 600)
        return
      }
      setActiveIdx(i)
    }, interval)

    return () => clearInterval(timer)
  }, [trailPlaying, stations])

  return (
    <div className="palace-modal__overlay" ref={overlayRef} onClick={onOverlayClick}>
      <div className="palace-modal">
        <button className="palace-modal__close" onClick={onClose} aria-label="关闭">
          ✕
        </button>

        <div className="palace-modal__body">
          <div className="palace-modal__image-wrap">
            {data.imageUrl ? (
              <img
                src={data.imageUrl}
                alt={data.label}
                className="palace-modal__image"
                draggable={false}
              />
            ) : (
              <div className="palace-modal__no-image">暂无图片</div>
            )}

            {stations.length >= 2 && (
              <svg
                className="palace-modal__trail-svg"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <path ref={pathRef} d={pathD} className="palace-modal__trail-path" />
              </svg>
            )}

            {stations.map((s, i) => (
              <StationPin key={s.order} station={s} active={activeIdx === i} />
            ))}
          </div>

          <div className="palace-modal__sidebar">
            <h2 className="palace-modal__title">{data.label || '记忆宫殿'}</h2>
            <p className="palace-modal__count">{stations.length} 个记忆站点</p>

            {stations.length >= 2 && (
              <button
                className="palace-modal__play-btn"
                onClick={playTrail}
                disabled={trailPlaying}
              >
                {trailPlaying ? '✦ 巡游中…' : '✦ 宫殿巡游'}
              </button>
            )}

            <ul className="palace-modal__station-list">
              {stations.map((s, i) => (
                <li
                  key={s.order}
                  className={`palace-modal__station${activeIdx === i ? ' palace-modal__station--active' : ''}`}
                >
                  <span className="palace-modal__station-order">{s.order}</span>
                  <div className="palace-modal__station-body">
                    <span className="palace-modal__station-anchor">{s.anchorVisual}</span>
                    <span className="palace-modal__station-content">{s.content}</span>
                    {s.association && (
                      <span className="palace-modal__station-assoc">{s.association}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
