import {convert2Image64} from "@/utils/base64Image";
import {Modality, Type} from "@google/genai";
import {GeminiAI} from "../GeminiAI";
import {GEMINI_TYPE} from "../types";
import {promts} from "./promts";

//先让ai生成图片（因为gemini-2.0-flash-exp不支持json输出以及系统提示词）
//然后向另一个ai生成json

//TODO  ERROR  错误： [ClientError: got status: 400 . {"error":{"code":400,"message":"Provided image is not valid.","status":"INVALID_ARGUMENT"}}]

class LandMarkAI extends GeminiAI {
  constructor() {
    super(GEMINI_TYPE.GEMINI_2_0_FLASH);
  }

  async sendMessage(
    message?: string,
    base64Image?: string
  ): Promise<{ text: string }> {
    if (!message?.trim() && !base64Image) throw new Error("输入不可以为空");
    const content = [
      {
        inlineData: {
          mimeType: "image/png",
          data: base64Image,
        },
      },
      {
        text: message,
      },
    ];

    const response = await this.genAI.models.generateContent({
      model: this.modelName,
      contents: content,
      config: {
        responseMimeType: "application/json",
        systemInstruction: `
        你是一个记忆宫殿的标记助手，用户给你一张图片以及需要记忆的主题或者内容，你需要将记忆的内容拆分多个地点然后与给定图片相关联形成一个记忆方法,
        `,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: "本次对话的标题",
            },
            node: {
              type: Type.ARRAY,
              description: "存放图片中记忆地点的坐标和相应内容的数组",
              items: {
                type: Type.OBJECT,
                properties: {
                  x: {
                    type: Type.NUMBER,
                    description: "图片中记忆地点的横坐标",
                  },
                  y: {
                    type: Type.NUMBER,
                    description: "图片中记忆地点的纵坐标",
                  },
                  data: {
                    type: Type.OBJECT,
                    description: "存放记忆地点的内容",
                    properties: {
                      label: {
                        type: Type.STRING,
                        description: "记忆地点的标签",
                      },
                      content: {
                        type: Type.STRING,
                        description: "记忆地点的内容",
                      },
                      lane: {
                        type: Type.STRING,
                        description: "记忆地点的记忆方法",
                      },
                    },
                    propertyOrdering: ["label", "content", "lane"],
                  },
                },
                propertyOrdering: ["x", "y", "data"],
              },
            },
          },
        },
      },
    });
    console.log("landMark:", response.text);
    return {text: response.text || ""};
  }
}

class MapAI extends GeminiAI {
  private landMarkAI: LandMarkAI;

  constructor() {
    super(GEMINI_TYPE.GEMINI_2_0_PREVIEW_IMAGE_GENERATION);
    this.landMarkAI = new LandMarkAI();
  }

  async sendMessage(message: string): Promise<{ text: string; image: string }> {
    const response1 = await this.genAI.models.generateContent({
      model: this.modelName,
      contents: `${promts}\n\n用户需要记忆${message}`,
      config: {
        responseModalities: [Modality.TEXT, Modality.IMAGE],
      },
    });
    let image = "";
    if (response1.candidates?.[0]?.content?.parts) {
      for (const part of response1.candidates[0].content.parts) {
        if (part.inlineData) {
          const imageData = part.inlineData.data;
          image += imageData;
        }
      }
    }
    console.log("生成图片", image);
    const response2 = await this.landMarkAI.sendMessage(message, image);
    return {
      text: response2.text,
      image: image,
    };
  }

  async mock(message: string): Promise<{ text: string; image: string }> {
    const size = 1024;
    const nodeSize = Math.floor(Math.random() * 6 + 1);
    const image: string = await convert2Image64(
      `https://picsum.photos/${size}`
    );
    const generateData = {
      title: "Mock Title",
      nodes: Array.from({length: nodeSize}, (_, index) => ({
        order: index + 1,
        x: Math.random() * size,
        y: Math.random() * size,
        data: {
          label: `Mock Label ${index + 1}`,
          content: `Mock Content ${index + 1}`,
          lane: `Mock Lane ${index + 1}`,
        },
      })),
    }
    const anchors = {
      order: 0,
      x: 0,
      y: 0,
      data: {
        label: "Mock Anchor 1",
        content: "Mock Anchor 1 Content",
        lane: "Mock Anchor 1 Lane",
      }
    };
    const anchor2 = {
      order: nodeSize + 1,
      x: size,
      y: size,
      data: {
        label: "Mock Anchor 2",
        content: "Mock Anchor 2 Content",
        lane: "Mock Anchor 2 Lane",
      }
    }
    generateData.nodes = generateData.nodes.concat(anchors, anchor2);
    const text = JSON.stringify(generateData);
    return {
      text: text,
      image: image,
    };
  }
}

export default new MapAI();
