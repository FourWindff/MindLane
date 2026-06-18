import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { _normalize_tool_result, cleanupToolResultOffloads } from "../toolResultNormalizer.js";
import { AGENT_LIMITS } from "../../config.js";
import {
  GENERATE_MINDMAP_FRAGMENT_TOOL,
  GENERATE_PALACE_TOOL,
} from "../subgraphRoutingTools.js";

describe("ToolResultNormalizer", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-result-normalizer-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns Chinese fallback for empty string", async () => {
    const result = await _normalize_tool_result("searchTool", "", "call-1");
    expect(result).toContain("该工具（searchTool）未返回任何内容");
  });

  it("returns Chinese fallback for whitespace-only result", async () => {
    const result = await _normalize_tool_result("searchTool", "   \n\t  ", "call-1");
    expect(result).toContain("该工具（searchTool）未返回任何内容");
  });

  it("returns Chinese fallback for null result", async () => {
    const result = await _normalize_tool_result("searchTool", null, "call-1");
    expect(result).toContain("该工具（searchTool）未返回任何内容");
  });

  it("returns Chinese fallback for undefined result", async () => {
    const result = await _normalize_tool_result("searchTool", undefined, "call-1");
    expect(result).toContain("该工具（searchTool）未返回任何内容");
  });

  it("returns Chinese fallback for object array with no text", async () => {
    const result = await _normalize_tool_result(
      "searchTool",
      [{ type: "image_url", image_url: "https://example.com/img.png" }],
      "call-1",
    );
    expect(result).toContain("该工具（searchTool）未返回任何内容");
  });

  it("returns normal content unchanged", async () => {
    const content = "这是一个正常的搜索结果。";
    const result = await _normalize_tool_result("searchTool", content, "call-1");
    expect(result).toBe(content);
  });

  it("normalizes object array content to string", async () => {
    const result = await _normalize_tool_result(
      "searchTool",
      [{ type: "text", text: "hello" }, { text: " world" }],
      "call-1",
    );
    expect(result).toBe("hello world");
  });

  it("offloads oversized content and returns summary with path", async () => {
    const content = "a".repeat(AGENT_LIMITS.toolResultOffloadChars + 100);
    const result = await _normalize_tool_result(
      "searchTool",
      content,
      "call-oversized",
      tmpDir,
    );

    expect(result).toContain("[工具结果较长，已转存到本地文件]");
    expect(result).toContain("完整结果路径：");
    expect(result.length).toBeLessThanOrEqual(
      AGENT_LIMITS.toolResultSummaryChars + 200,
    );

    const offloadDir = path.join(tmpDir, AGENT_LIMITS.toolResultOffloadDirName);
    const files = await fs.promises.readdir(offloadDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^call-oversized-searchTool\.txt$/);

    const saved = await fs.promises.readFile(path.join(offloadDir, files[0]!), "utf8");
    expect(saved).toBe(content);
  });

  it("truncates content exceeding max chars when no userDataDir", async () => {
    const content = "a".repeat(AGENT_LIMITS.toolResultMaxChars + 100);
    const result = await _normalize_tool_result("searchTool", content, "call-trunc");

    expect(result.length).toBeLessThanOrEqual(AGENT_LIMITS.toolResultMaxChars);
    expect(result).toContain("[内容已超出");
    expect(result).toContain("字符上限，已截断。]");
  });

  it("truncates with file reference when offloaded and still too long", async () => {
    const summaryPadding = 500;
    const content =
      "a".repeat(AGENT_LIMITS.toolResultMaxChars + AGENT_LIMITS.toolResultSummaryChars + summaryPadding);
    const result = await _normalize_tool_result(
      "searchTool",
      content,
      "call-big",
      tmpDir,
    );

    expect(result).toContain("完整结果已保存到：");
    expect(result.length).toBeLessThanOrEqual(AGENT_LIMITS.toolResultMaxChars);
  });

  it("keeps exempt tools unchanged and does not offload", async () => {
    const content = "a".repeat(AGENT_LIMITS.toolResultMaxChars + 100);

    const mindmapResult = await _normalize_tool_result(
      GENERATE_MINDMAP_FRAGMENT_TOOL,
      content,
      "call-exempt-1",
      tmpDir,
    );
    expect(mindmapResult).toBe(content);

    const palaceResult = await _normalize_tool_result(
      GENERATE_PALACE_TOOL,
      content,
      "call-exempt-2",
      tmpDir,
    );
    expect(palaceResult).toBe(content);

    const offloadDir = path.join(tmpDir, AGENT_LIMITS.toolResultOffloadDirName);
    expect(fs.existsSync(offloadDir)).toBe(false);
  });

  it("does not apply empty fallback to exempt tools", async () => {
    const result = await _normalize_tool_result(
      GENERATE_MINDMAP_FRAGMENT_TOOL,
      "",
      "call-empty-exempt",
      tmpDir,
    );
    expect(result).toContain("该工具（generateMindmapFragment）未返回任何内容");
  });

  it("returns plain summary when userDataDir is missing", async () => {
    const content = "b".repeat(AGENT_LIMITS.toolResultOffloadChars + 50);
    const result = await _normalize_tool_result("searchTool", content, "call-nodir");

    expect(result).toContain("[工具结果较长，但转存到本地文件失败]");
    expect(result).not.toContain("完整结果路径：");
  });

  it("sanitizes file names with special characters", async () => {
    const content = "c".repeat(AGENT_LIMITS.toolResultOffloadChars + 50);
    await _normalize_tool_result(
      "tool/with\\special:chars",
      content,
      "call-id/with:chars",
      tmpDir,
    );

    const offloadDir = path.join(tmpDir, AGENT_LIMITS.toolResultOffloadDirName);
    const files = await fs.promises.readdir(offloadDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^call-id_with_chars-tool_with_special_chars\.txt$/);
  });

  it("cleans up stale offloaded tool result files", async () => {
    const offloadDir = path.join(tmpDir, AGENT_LIMITS.toolResultOffloadDirName);
    fs.mkdirSync(offloadDir, { recursive: true });
    const staleFile = path.join(offloadDir, "stale.txt");
    const recentFile = path.join(offloadDir, "recent.txt");
    const nestedDir = path.join(offloadDir, "nested");
    fs.writeFileSync(staleFile, "old", "utf8");
    fs.writeFileSync(recentFile, "new", "utf8");
    fs.mkdirSync(nestedDir);

    const now = new Date();
    const stale = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(staleFile, stale, stale);
    fs.utimesSync(recentFile, now, now);

    const removed = await cleanupToolResultOffloads(tmpDir, {
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
      now: now.getTime(),
    });

    expect(removed).toBe(1);
    expect(fs.existsSync(staleFile)).toBe(false);
    expect(fs.existsSync(recentFile)).toBe(true);
    expect(fs.existsSync(nestedDir)).toBe(true);
  });
});
