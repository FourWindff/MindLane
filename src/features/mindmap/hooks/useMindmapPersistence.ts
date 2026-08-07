import { useCallback, useEffect, useRef } from 'react'
import { toPng } from 'html-to-image'
import type { ReactFlowInstance } from '@xyflow/react'
import { selectCurrentChatBusy, useAiStore } from '@/features/chat/model/aiStore'
import { saveMindmapInstance } from '../model/saveMindmapInstance'
import { useActiveMindmapInstance } from './useActiveMindmapInstance'
import { useActiveMindmapStore } from './useActiveMindmapStore'
import { useSettingsStore } from '@/features/settings/model/settingsStore'
import { useWorkspaceStore } from '@/features/workspace/store'

export function useMindmapPersistence() {
  const activeInstance = useActiveMindmapInstance()
  const aiBusy = useAiStore(selectCurrentChatBusy)
  const autoSaveIntervalMs = useSettingsStore((state) => state.autoSaveIntervalMs)
  const dirty = useActiveMindmapStore((state) => state.dirty)
  const filePath = useActiveMindmapStore((state) => state.filePath)
  const hasDocumentOpen = useActiveMindmapStore((state) => state.hasDocumentOpen)
  const syncAfterFileSaved = useWorkspaceStore((state) => state.syncAfterFileSaved)
  const updateFilePreviewUrl = useWorkspaceStore((state) => state.updateFilePreviewUrl)
  const hiddenFlowRef = useRef<HTMLDivElement>(null)
  const hiddenRfInstanceRef = useRef<ReactFlowInstance | null>(null)

  const generateThumbnail = useCallback(async (savedFilePath: string): Promise<string | null> => {
    try {
      const hiddenWrap = hiddenFlowRef.current
      if (!hiddenWrap) return null

      const hiddenFlow = hiddenWrap.querySelector('.react-flow') as HTMLElement | null
      if (!hiddenFlow) return null

      hiddenRfInstanceRef.current?.fitView({ padding: 0.2, duration: 0 })
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

      const dataUrl = await toPng(hiddenFlow, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        style: { backgroundImage: 'none' },
        filter: (node) => {
          const classList = node.classList
          if (!classList) return true
          return (
            !classList.contains('react-flow__background') && !classList.contains('mindmap-minimap')
          )
        },
      })

      const result = await window.mindlane?.file.saveThumbnail({
        filePath: savedFilePath,
        imageData: dataUrl,
      })
      return result?.ok ? result.data.previewUrl : null
    } catch (error) {
      console.warn('[MindLane] 预览图生成失败：', error)
      return null
    }
  }, [])

  const save = useCallback(async () => {
    const store = activeInstance.store.getState()
    if (!store.filePath) {
      // Unsaved document: the main process turns a null filePath into the
      // save-as dialog; this flow is outside the save protocol.
      const ai = useAiStore.getState()
      try {
        const data = store.toMindLaneFile()
        const result = await window.mindlane?.file.save({ filePath: null, data })
        if (!result?.ok) return

        store.setFilePath(result.data.filePath)
        store.markClean()
        await syncAfterFileSaved(result.data.filePath)

        void generateThumbnail(result.data.filePath).then((previewUrl) => {
          if (previewUrl) updateFilePreviewUrl(result.data.filePath, previewUrl)
        })
      } catch (error) {
        console.error('[MindLane] 保存失败：', error)
        ai.setError(`保存失败：${error instanceof Error ? error.message : String(error)}`)
      }
      return
    }
    await saveMindmapInstance(activeInstance, {
      onError: (message) => {
        console.error(`[MindLane] ${message}`)
        useAiStore.getState().setError(message)
      },
      afterSave: (savedFilePath) => {
        void generateThumbnail(savedFilePath).then((previewUrl) => {
          if (previewUrl) updateFilePreviewUrl(savedFilePath, previewUrl)
        })
      },
    })
  }, [activeInstance, generateThumbnail, syncAfterFileSaved, updateFilePreviewUrl])

  useEffect(() => {
    if (!hasDocumentOpen || !dirty || !filePath || aiBusy || autoSaveIntervalMs <= 0) return

    const timer = window.setTimeout(() => {
      void save()
    }, autoSaveIntervalMs)
    return () => window.clearTimeout(timer)
  }, [aiBusy, autoSaveIntervalMs, dirty, filePath, hasDocumentOpen, save])

  return { save, hiddenFlowRef, hiddenRfInstanceRef }
}
