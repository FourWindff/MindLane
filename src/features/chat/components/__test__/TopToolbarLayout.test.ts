import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('top toolbar layout', () => {
  it('aligns the chat panel elements to one shared width', () => {
    const shellCss = fs.readFileSync(path.resolve('src/app/styles/app-shell.css'), 'utf8')
    const css = fs.readFileSync(
      path.resolve('src/features/chat/styles/chat-capsule-bar.css'),
      'utf8',
    )
    const messageListCss = fs.readFileSync(
      path.resolve('src/features/chat/styles/chat-message-list.css'),
      'utf8',
    )
    const inputCss = fs.readFileSync(
      path.resolve('src/features/chat/styles/chat-input-bar.css'),
      'utf8',
    )

    expect(shellCss).toMatch(/\.chat-panel\s*{[^}]*width:\s*min\(360px, calc\(100vw - 32px\)\)/s)
    expect(css).toMatch(/\.chat-capsule-bar\s*{[^}]*width:\s*100%/s)
    expect(messageListCss).toMatch(/\.chat-message-list\s*{[^}]*width:\s*100%/s)
    expect(inputCss).toMatch(/\.chat-input-bar\s*{[^}]*width:\s*100%/s)
  })

  it('uses the capsule edge to squeeze and fade the mind map header', () => {
    const css = fs.readFileSync(path.resolve('src/features/mindmap/styles/toolbar.css'), 'utf8')

    expect(css).toMatch(
      /\.mindmap-header\s*{[^}]*left:\s*var\(--app-toolbar-right\)[^}]*right:\s*376px[^}]*transition:\s*right 0\.25s ease/s,
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
