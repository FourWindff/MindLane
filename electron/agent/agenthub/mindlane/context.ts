import { BaseMessage } from "@langchain/core/messages";
import type { MindmapContextData } from "../../tools/mindmapContext.js";
import type { CapabilityFlags } from "./mindlaneAgent.js";

/**
 * 主上下文构建器 - 组装 System Prompt
 */
export class ContextBuilder {
    private prompt: string = '';
    private messages: BaseMessage[] = [];
    private context?: MindmapContextData;
    private capabilityFlags: CapabilityFlags = { hasEmbeddings: true, hasPalace: true };

    /**
     * 设置消息历史（由 Orchestrator 加载后传入）
     */
    withMessages(messages: BaseMessage[]): this {
        this.messages = messages;
        return this;
    }

    /**
     * 设置思维导图上下文
     */
    withContext(context?: MindmapContextData): this {
        this.context = context;
        return this;
    }

    /**
     * 设置能力标志
     */
    withCapabilityFlags(flags?: CapabilityFlags): this {
        if (flags) this.capabilityFlags = flags;
        return this;
    }

    buildSystemPrompt(): this {
        const features = ['思维导图创作'];
        if (this.capabilityFlags.hasEmbeddings) {
            features.push('知识管理');
        }
        if (this.capabilityFlags.hasPalace) {
            features.push('记忆训练');
        }

        this.prompt += `<SYSTEM_PROMPT>
你是 MindLane 的 AI 助手，帮助用户进行${features.join('、')}。
</SYSTEM_PROMPT>
`;
        return this;
    }

    buildEnvironmentPrompt(): this {
        const platform = process.platform;
        const isWindows = platform === 'win32';
        const runtime = isWindows ? `Windows` : platform === 'darwin' ? `macOS` : `Linux`;

        const platformPolicy = isWindows
            ? `## Platform Policy (Windows)
- You are running on Windows. Do not assume GNU tools like \`grep\`, \`sed\`, or \`awk\` exist.
- Prefer Windows-native commands or file tools when they are more reliable.`
            : `## Platform Policy (POSIX)
- You are running on a POSIX system (macOS/Linux). Prefer UTF-8 and standard shell tools.`;

        this.prompt += `<ENV>
# runtime: ${runtime}
# platform_policy: ${platformPolicy}
</ENV>
`;
        return this;
    }

    buildMindmapContext(): this {
        if (this.context?.hasDocumentOpen) {
            this.prompt += `<MINDMAP file_path="${this.context.filePath || ''}">
# ${this.context.fileTitle || '未命名思维导图'}
`;

            if (this.context.mindmapSummary) {
                this.prompt += `${this.context.mindmapSummary}\n`;
            }

            if (this.context.selectedNodes && this.context.selectedNodes.length > 0) {
                this.prompt += `<SELECTED_NODES count="${this.context.selectedNodes.length}">\n`;
                for (const node of this.context.selectedNodes) {
                    this.prompt += `  <node id="${node.id}" type="${node.type}" label="${node.label || ''}"/>\n`;
                }
                this.prompt += `</SELECTED_NODES>\n`;
            }

            this.prompt += `</MINDMAP>
`;
        }
        return this;
    }

    buildHistory(): this {
        // 过滤掉 system 消息，只保留用户和 AI 的对话
        const historyMessages = this.messages.filter(m => {
            const type = m.type;
            return type === 'human' || type === 'ai';
        });

        if (historyMessages.length > 0) {
            const historyText = historyMessages.map(m => {
                const type = m.type;
                const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                return `[${type}]: ${content}`;
            }).join('\n');

            this.prompt += `<HISTORY>
${historyText}
</HISTORY>
`;
        }
        return this;
    }

    /**
     * 构建最终的 System Prompt
     */
    build(): string {
        return this.prompt.trim();
    }
}

