/**
 * 从 LangChain message content 中提取文本
 * Anthropic 格式返回 content 是数组 [{type:"text", text:"..."}]
 * OpenAI 格式返回 content 是字符串
 */
export function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is { type: string; text: string } =>
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "text" &&
          "text" in block,
      )
      .map((block) => block.text)
      .join("");
  }
  return "";
}

/**
 * 将 LangChain message content 宽松地字符串化。
 *
 * 与 {@link extractTextContent} 的区别：
 * - `extractTextContent` 严格筛选 `{ type: "text", text: ... }` 形态的 block；
 * - `messageContentToString` 不检查 `type`，只要 block 上带 `text` 字段就字符串化，
 *   同时保留数组中纯字符串 block 的内容，并 join 所有 block。
 *
 * 适用于视觉模型等返回 content 形态不规范的场景（例如某些 provider 把 JSON
 * 文本放在没有 `type:"text"` 标记的对象中）。
 */
export function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block) {
          return String((block as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}
