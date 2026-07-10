import { create } from 'zustand'

interface Toast {
  id: string
  message: string
}

interface ToastState {
  toasts: Toast[]
  showToast: (message: string) => void
  dismissToast: (id: string) => void
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  showToast: (message) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    set({ toasts: [{ id, message }] })

    window.setTimeout(() => {
      get().dismissToast(id)
    }, 3000)
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
  },
}))

export function showToast(message: string): void {
  useToastStore.getState().showToast(message)
}
