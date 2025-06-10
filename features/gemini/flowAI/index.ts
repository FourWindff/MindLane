import { Type } from "@google/genai";
import { GeminiAI } from "../GeminiAI";
import { GEMINI_TYPE } from "../types";
import { FLOWAI_PROMTS } from "./promts";

const DEFAULT_MIME_TYPE = "image/png";
class FlowAI extends GeminiAI {
  constructor() {
    super(GEMINI_TYPE.GEMINI_2_0_FLASH);
  }
  async sendMessage(
    message?: string,
    base64Image?: string,
    mimeType: string = DEFAULT_MIME_TYPE): Promise<{ text: string; }> {
    if (!message?.trim() && !base64Image) throw new Error("输入不可以为空");
    
    const content = [];
    
    if (base64Image) {
      content.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Image,
        },
      });
    }
    
    if (message?.trim()) {
      content.push({
        text: message,
      });
    }

    console.log("FlowAI:send",message);
    console.log("FlowAI:send",base64Image?.slice(0,100))
    const response = await this.genAI.models.generateContent({
      model: this.modelName,
      contents: content,
      config: {
        responseMimeType: "application/json",
        systemInstruction: FLOWAI_PROMTS,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: "本次对话的标题"
            },
            answer: {
              type: Type.STRING,
              description: "待解决问题的解法"
            },
            nodes: {
              type: Type.ARRAY,
              description: "每一个步骤对应一个节点",
              items: {
                type: Type.OBJECT,
                properties: {
                  id: {
                    type: Type.STRING,
                    description: "该步骤的唯一ID"
                  },
                  parentId: {
                    type: Type.ARRAY,
                    description: "该步骤的前一步骤的ID数组",
                    items: {
                      type: Type.STRING,
                      description: "步骤ID"
                    }
                  },
                  childId: {
                    type: Type.ARRAY,
                    description: "该步骤的后一步骤的ID数组",
                    items: {
                      type: Type.STRING,
                      description: "步骤ID"
                    }
                  },
                  label: {
                    type: Type.STRING,
                    description: "该步骤一个简单标签"
                  },
                  content: {
                    type: Type.STRING,
                    description: "该步骤对应的内容"
                  }
                },
                propertyOrdering:['id','parentId','childId','label','content']
              },
            }
            
          },
          propertyOrdering:['title','answer','nodes']
        }
      }
    });
    console.log("FlowAI:", response.text);
    return { text: response.text || "" };
  }
}

export default new FlowAI();