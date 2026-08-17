import { DOMParser as LinkedomDOMParser } from 'linkedom'
import { registerXmlDomParser } from './src/shared/lib/mindmapXml/parser'

/**
 * 测试环境（Electron-as-Node）没有全局 DOMParser：注入 linkedom，
 * 与主进程装配方式一致（解析内核按进程注入，渲染层才用浏览器 DOMParser）。
 */
if (typeof (globalThis as { DOMParser?: unknown }).DOMParser !== 'function') {
  registerXmlDomParser(LinkedomDOMParser)
}
