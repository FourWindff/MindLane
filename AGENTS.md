<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **MindLane** (5961 symbols, 12152 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource                                  | Use for                                  |
| ----------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/MindLane/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/MindLane/clusters`       | All functional areas                     |
| `gitnexus://repo/MindLane/processes`      | All execution flows                      |
| `gitnexus://repo/MindLane/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->

## pi（pi-coding-agent）

仅 pi 会话适用：pi 无 MCP 客户端，上方 `gitnexus_*` 工具名在 pi 中不存在；每条指令换成等价 CLI 子命令执行，语法以 `npx gitnexus <子命令> --help` 为准（本机索引了多个仓库，命令需带 `-r MindLane`）：

- `gitnexus_impact` → `npx gitnexus impact -r MindLane <symbol>`（默认 upstream）
- `gitnexus_detect_changes` → `npx gitnexus detect-changes -r MindLane -s staged`
- `gitnexus_query` → `npx gitnexus query -r MindLane "<概念>"`
- `gitnexus_context` → `npx gitnexus context -r MindLane <symbol>`（重名加 `-f <file>` 消歧）
- `gitnexus_rename` 无 CLI 等价 → 读 `context`/`impact` 调用图后手工重构

已知缺口（gitnexus 1.6.4，上游待修）：调用图对部分生产调用点漏建边（如 `trimToRecentWindow` / `maybe_consolidate_by_tokens` 的调用方缺失）。`impact`/`context` 显示调用方为 0 或 LOW 时，先 `grep -rn "<符号名>" electron/ src/` 交叉核对，确认无漏边再下结论。

索引：大改动后 `npx gitnexus analyze`；`npx gitnexus status` 查新鲜度。

## Agent skills

### Issue tracker

Issues and PRDs live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five canonical label strings unchanged (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: read `CONTEXT.md` at the repo root and `docs/adr/` for architectural decisions. See `docs/agents/domain.md`.
