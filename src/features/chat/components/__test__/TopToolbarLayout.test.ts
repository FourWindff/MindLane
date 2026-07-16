import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('top toolbar layout', () => {
  it('expands the capsule bar leftward to the app toolbar edge', () => {
    const css = fs.readFileSync(
      path.resolve('src/features/chat/styles/chat-capsule-bar.css'),
      'utf8',
    )

    expect(css).toMatch(/\.chat-capsule-bar\s*{[^}]*left:\s*calc\(100vw - 230px\)/s)
    expect(css).toMatch(/\.chat-capsule-bar\s*{[^}]*transition:[^}]*left 0\.25s ease/s)
    expect(css).toMatch(/\.chat-capsule-bar--expanded\s*{[^}]*left:\s*var\(--app-toolbar-right\)/s)
  })

  it('uses the capsule edge to squeeze and fade the mind map header', () => {
    const css = fs.readFileSync(path.resolve('src/features/mindmap/styles/toolbar.css'), 'utf8')

    expect(css).toMatch(
      /\.mindmap-header\s*{[^}]*left:\s*var\(--app-toolbar-right\)[^}]*right:\s*230px[^}]*transition:\s*right 0\.25s ease/s,
    )
    expect(css).toMatch(
      /\.mindmap-header--capsule-expanded\s*{[^}]*right:\s*calc\(100vw - var\(--app-toolbar-right\)\)/s,
    )
    expect(css).toMatch(
      /\.mindmap-header__toolbar-viewport\s*{[^}]*min-width:\s*0[^}]*overflow:\s*hidden/s,
    )
    expect(css).not.toMatch(/scaleX\(/)
  })

  it('restores the mind map header when capsules collapse', () => {
    const css = fs.readFileSync(path.resolve('src/features/mindmap/styles/toolbar.css'), 'utf8')

    expect(css).toMatch(
      /\.mindmap-header__panel\s*{[^}]*opacity:\s*1[^}]*transition:[^}]*opacity 0\.25s ease/s,
    )
  })
})
