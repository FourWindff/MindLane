import { convert2Image64 } from "@/utils/base64Image";
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
        systemInstruction:
          "你是一个记忆宫殿的标记助手，用户给你一张图片以及需要记忆的主题或者内容，你需要将记忆的内容拆分多个地点然后与给定图片相关联形成一个记忆方法，你需要返回地点的坐标、地点名称、记忆内容、助记方法",
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
    console.log("landMark:", response.text);
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

  async sendMessageWithAssetImage(
    message: string
  ): Promise<{ text: string; image: string }> {
    const image = await convert2Image64(
      "/home/kris/Code/MindLane/assets/test.png"
    );
    console.log(image);
    console.log("123s")
    const response = await this.landMarkAI.sendMessage(message, image);
    return { text: response.text, image: image };
  }
}

export default new MindMapAI();
