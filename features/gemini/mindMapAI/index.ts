import { Modality, Type } from "@google/genai";
import { GeminiAI } from "../GeminiAI";
import { GEMINI_TYPE } from "../types";
import { promts } from "./promts";

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
          mimeType: "image/jpeg",
          data: base64Image,
        },
      },
      {
        text: `这是用户需要记忆的内容：${message}\n 请你根据上传的图片作为记忆宫殿的图片，你需要根据用户需要记忆的内容输出数据，数据包括记忆的地点在图片中的坐标，以及需要地点名、记忆内容、助记方法`,
      },
    ];

    const response = await this.genAI.models.generateContent({
      model: this.modelName,
      contents: content,
      config: {
        responseMimeType: "application/json",
        systemInstruction:"你不是人",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
            },
            node: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  x: {
                    type: Type.NUMBER,
                  },
                  y: {
                    type: Type.NUMBER,
                  },
                  data: {
                    type: Type.OBJECT,
                    properties: {
                      label: {
                        type: Type.STRING,
                      },
                      content: {
                        type: Type.STRING,
                      },
                      lane: {
                        type: Type.STRING,
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

    return { text: response.text || "" };
  }
}

class MindMapAI extends GeminiAI {
  private landMarkAI: LandMarkAI;
  constructor() {
    super(GEMINI_TYPE.GEMINI_2_0_FLASH_EXP);
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
    const response2 = await this.landMarkAI.sendMessage(message, image);
    const result = {
      text: response2.text,
      image: image,
    };
    return result;
  }
}

export default new MindMapAI();
