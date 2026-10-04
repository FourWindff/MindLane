import { DOMParser as LinkedomDOMParser } from 'linkedom'
import { registerXmlDomParser } from './contracts/mindmapXml/parser'

/**
 * The test environment (Electron-as-Node) has no global DOMParser, so inject linkedom,
 * matching how the main process is wired (the parsing kernel is injected per process;
 * only the renderer uses the browser DOMParser).
 */
if (typeof (globalThis as { DOMParser?: unknown }).DOMParser !== 'function') {
  registerXmlDomParser(LinkedomDOMParser)
}
