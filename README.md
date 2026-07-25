<p align="center">
  <img src="public/assets/mindlane-logo.svg" alt="MindLane" width="96" />
</p>

<h1 align="center">MindLane</h1>

<p align="center">
  An AI-powered desktop mind-mapping app.<br/>
  Turn ideas, documents, and conversations into living mind maps.
</p>

<p align="center">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white" />
  <img alt="LangGraph" src="https://img.shields.io/badge/LangGraph-1C3C3C?logo=langchain&logoColor=white" />
</p>

---

## Features

### ✨ AI Generation & Chat

Describe what you're thinking in the floating chat panel and watch a mind map grow on the canvas. The assistant streams its progress live, and can keep refining the map — adding branches, restructuring nodes, and answering questions about what it built.

### 📄 Documents to Mindmap

Drop in what you already have and get a structured map back:

| Format             | Source                           |
| ------------------ | -------------------------------- |
| PDF                | research papers, reports, ebooks |
| DOCX / PPTX / XLSX | Office documents                 |
| Markdown           | notes and drafts                 |
| Web URL            | articles and pages               |
| Plain text         | anything on your clipboard       |

### 🎨 Canvas Editing

A fast, free-form canvas built on React Flow. Drag nodes anywhere, restyle them in the style panel, auto-layout when things get messy, and drive everything from the keyboard.

### 🔌 Multi-Provider

Bring your own API key — switch providers without changing how you work.

- Anthropic
- OpenAI
- Kimi
- MiniMax
- DashScope

### 🧩 MCP Extensions

Extend what the assistant can reach through the **Model Context Protocol**. A built-in server catalog, extensible via `settings.json`:

<picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.simpleicons.org/notion/white" /><img alt="Notion" src="https://cdn.simpleicons.org/notion/black" height="16" /></picture>&nbsp; **Notion** — hosted remote server, one-click OAuth

---

## Getting Started

```bash
npm install
npm run dev      # start the app (Vite + Electron)
npm run build    # type-check, bundle, and package with electron-builder
```

Then open **Settings**, pick a provider, and paste in your API key.

---

<p align="center">
  <a href="https://github.com/FourWindff/MindLane">github.com/FourWindff/MindLane</a>
</p>
