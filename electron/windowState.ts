import { app, screen } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const FILE_NAME = 'window-state.json'

/** Default size on first open or when there is no saved record (avoids a window that is too small) */
const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 820
export const MIN_WIDTH = 880
export const MIN_HEIGHT = 560

type SavedBounds = {
  width: number
  height: number
  x: number
  y: number
}

function statePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function parseSaved(raw: string): SavedBounds | null {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>
    const width = Number(j.width)
    const height = Number(j.height)
    const x = Number(j.x)
    const y = Number(j.y)
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return null
    }
    if (width < MIN_WIDTH || height < MIN_HEIGHT || width > 4096 || height > 4096) {
      return null
    }
    return {
      width: Math.floor(width),
      height: Math.floor(height),
      x: Math.floor(x),
      y: Math.floor(y),
    }
  } catch {
    return null
  }
}

/** Read the last saved window rectangle; returns null when invalid */
export function loadWindowBounds(): SavedBounds | null {
  try {
    const p = statePath()
    if (!fs.existsSync(p)) return null
    return parseSaved(fs.readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

/** Combine with the primary display work area to get bounds usable by BrowserWindow */
export function resolveWindowBounds(saved: SavedBounds | null): SavedBounds {
  const primary = screen.getPrimaryDisplay().workArea
  const w = saved
    ? Math.min(Math.max(saved.width, MIN_WIDTH), Math.max(MIN_WIDTH, primary.width))
    : Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, primary.width))
  const h = saved
    ? Math.min(Math.max(saved.height, MIN_HEIGHT), Math.max(MIN_HEIGHT, primary.height))
    : Math.min(DEFAULT_HEIGHT, Math.max(MIN_HEIGHT, primary.height))

  let x: number
  let y: number
  if (saved) {
    const displays = screen.getAllDisplays()
    const ok = displays.some((d) => {
      const wa = d.workArea
      return (
        saved.x + w > wa.x &&
        saved.x < wa.x + wa.width &&
        saved.y + h > wa.y &&
        saved.y < wa.y + wa.height
      )
    })
    if (ok) {
      x = saved.x
      y = saved.y
    } else {
      x = Math.round(primary.x + (primary.width - w) / 2)
      y = Math.round(primary.y + (primary.height - h) / 2)
    }
  } else {
    x = Math.round(primary.x + (primary.width - w) / 2)
    y = Math.round(primary.y + (primary.height - h) / 2)
  }

  return { width: w, height: h, x, y }
}

export function saveWindowBounds(bounds: SavedBounds): void {
  try {
    const p = statePath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(
      p,
      JSON.stringify(
        {
          width: bounds.width,
          height: bounds.height,
          x: bounds.x,
          y: bounds.y,
        },
        null,
        0,
      ),
      'utf-8',
    )
  } catch {
    /* ignore */
  }
}
