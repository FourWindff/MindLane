import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { IPC } from '../../electron/ipc'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

window.ipcRenderer.on(IPC.MainProcessMessage, (_event, message) => {
  console.log(message)
})
