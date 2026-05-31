import { BaseMessage } from "@langchain/core/messages";
import type { MindmapContextData } from "../../tools/mindmapContext.js";
import type { CapabilityFlags } from "./mindlaneAgent.js";
import { MemoryManager } from "../../memory/memoryManager.js";

const MEMORY_INDEX_TAG = 'USER_MEMORY_INDEX';
const RELEVANT_MEMORIES_TAG = 'RELEVANT_MEMORIES';

/**
 * 主上下文构建器 - 组装 System Prompt
 */
export class ContextBuilder {
    private prompt: string = '';
    private messages: BaseMessage[] = [];
    private context?: MindmapContextData;
    private capabilityFlags: CapabilityFlags = { hasEmbeddings: true, hasPalace: true };
    private memoryManager?: MemoryManager;

    withMessages(messages: BaseMessage[]): this {
        this.messages = messages;
        return this;
    }

    withContext(context?: MindmapContextData): this {
        this.context = context;
        return this;
    }

    withCapabilityFlags(flags?: CapabilityFlags): this {
        if (flags) this.capabilityFlags = flags;
        return this;
    }

    withMemory(manager: MemoryManager | undefined): this {
        this.memoryManager = manager;
        return this;
    }

    async buildMemoryContext(): Promise<this> {
        if (!this.memoryManager) return this;
        const tags = this.context?.fileTags;
        const [index, memories] = await Promise.all([
            this.memoryManager.loadIndex(),
            tags?.length ? this.memoryManager.loadMemoriesForTags(tags) : Promise.resolve([] as string[]),
        ]);
        if (index.trim()) {
            this.prompt += `<${MEMORY_INDEX_TAG}>\n${index.trim()}\n</${MEMORY_INDEX_TAG}>\n`;
        }
        if (memories.length > 0 && tags) {
            this.prompt += `<${RELEVANT_MEMORIES_TAG} tags="${tags.join(',')}">\n${memories.join('\n\n')}\n</${RELEVANT_MEMORIES_TAG}>\n`;
        }
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
当用户需要从文档、URL 或文本生成思维导图时，先调用 generateMindmapFragment；工具返回 YAML 后，再根据当前思维导图上下文调用 batchAddMindmapNodes 选择插入位置。
当用户要求根据已关联的原文件、原文、文档章节或文档内容修改当前思维导图时，先调用 searchLinkedDocument 检索相关片段，再调用思维导图操作工具修改节点。
当用户需要生成记忆宫殿时，先调用 generatePalace；工具返回宫殿数据后，再根据当前思维导图上下文调用 addPalaceNode 选择插入位置。
generateMindmapFragment 和 generatePalace 的结果是待落图数据，不要直接复制给用户。
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

        if (this.context?.attachedDocument) {
            const doc = this.context.attachedDocument;
            this.prompt += `<ATTACHED_DOCUMENT type="${doc.type}" filename="${doc.filename}" path="${doc.source}">
用户已附加文档「${doc.filename}」，请根据此文档内容生成思维导图。
</ATTACHED_DOCUMENT>
`;
        }

        if (this.context?.linkedDocuments && this.context.linkedDocuments.length > 0) {
            this.prompt += `<LINKED_DOCUMENTS count="${this.context.linkedDocuments.length}">
`;
            for (const doc of this.context.linkedDocuments) {
                const textCacheKey = doc.metadata?.textCacheKey || doc.id;
                this.prompt += `  <document id="${doc.id}" type="${doc.type}" filename="${doc.filename}" text_cache_key="${textCacheKey}"/>
`;
            }
            this.prompt += `</LINKED_DOCUMENTS>
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
