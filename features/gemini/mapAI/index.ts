import { fetchImage2Base64 } from "@/utils/base64Image";
import { ContentListUnion, Modality, Type } from "@google/genai";
import { GeminiAI } from "../GeminiAI";
import { GEMINI_TYPE } from "../types";
import { markerAIPromts, mapAIPromts } from "./promts";

//FIXME ERROR  错误： [ClientError: got status: 400 . {"error":{"code":400,"message":"Provided image is not valid.","status":"INVALID_ARGUMENT"}}]
//FIXME  LOG  landMark: {
//  "title": "算法五大特性记忆宫殿法构建方案：从宇宙沙漏到知识殿堂之旅，五大特性刻入你的记忆深处！🚀🧠✨⏳🔑📚💡⚙️🌟🌌🤯🔮🔍🏆🥇🎯🖼️📝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝🤝
//FIXME 有时候不生成坐标  LOG  [{"data": {"content": "merge history page and storage page", "label": "入口区域", "lane": "入口处放置着一个巨大的、正在全息投影“merge history page and storage page”字样的球体，球体周围环绕着闪烁的数据流，象征着历史页面和存储页面的合并。"}},
const DEFAULT_MIME_TYPE = "image/png";

class LandMarkAI extends GeminiAI {
  constructor() {
    super(GEMINI_TYPE.GEMINI_2_0_FLASH);
  }

  async sendMessage(
    message?: string,
    base64Image?: string,
    mimeType: string = DEFAULT_MIME_TYPE
  ): Promise<{ text: string }> {
    if (message?.trim() === "" && !base64Image)
      throw new Error("输入不可以为空");
    const content = [
      {
        inlineData: {
          mimeType: mimeType,
          data: base64Image,
        },
      },
      {
        text: message,
      },
    ];
    //FIXME 坐标标注不准确
    const response = await this.genAI.models.generateContent({
      model: this.modelName,
      contents: content,
      config: {
        responseMimeType: "application/json",
        systemInstruction: markerAIPromts,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: "本次对话的标题,与记忆内容有关",
            },
            nodes: {
              type: Type.ARRAY,
              description: "存放图片中记忆地点的坐标和相应内容的数组",
              items: {
                type: Type.OBJECT,
                properties: {
                  x: {
                    type: Type.NUMBER,
                    description:
                      "图片中记忆地点的横坐标，坐标原点是图片的左上角，单位是像素",
                  },
                  y: {
                    type: Type.NUMBER,
                    description:
                      "图片中记忆地点的纵坐标，坐标原点是图片的左上角，单位是像素",
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
    console.log("landMark:", response.text?.slice(0, 200));
    return { text: response.text || "" };
  }
}

class MapAI extends GeminiAI {
  private landMarkAI: LandMarkAI;

  constructor() {
    super(GEMINI_TYPE.GEMINI_2_0_PREVIEW_IMAGE_GENERATION);
    this.landMarkAI = new LandMarkAI();
  }

  async sendMessage(
    message?: string,
    base64Image?: string,
    imageMimeType: string = DEFAULT_MIME_TYPE
  ): Promise<{ text: string; image: string; mimeType: string }> {
    if (message?.trim() === "" && !base64Image)
      throw new Error("输入不可以为空");
    const contents: ContentListUnion = [
      {
        text: mapAIPromts,
      },
    ];
    if (message?.trim() !== "") {
      console.log();
      contents.push({
        text: message,
      });
    }
    if (base64Image) {
      contents.push({
        inlineData: {
          mimeType: imageMimeType,
          data: base64Image,
        },
      });
    }

    const response1 = await this.genAI.models.generateContent({
      model: this.modelName,
      contents: contents,
      config: {
        responseModalities: [Modality.TEXT, Modality.IMAGE],
      },
    });
    let base64ImageData = "";
    let mimeType;
    let responseText = "";
    if (response1.candidates?.[0]?.content?.parts) {
      mimeType = response1.candidates[0].content.parts[0].inlineData?.mimeType;
      for (const part of response1.candidates[0].content.parts) {
        if (part.text) {
          responseText += part.text;
        } else if (part.inlineData) {
          base64ImageData += part.inlineData.data;
        }
      }
    }
    mimeType = mimeType || DEFAULT_MIME_TYPE;
    //FIXME 有时候AI不会生成图片，
    //FIXME 图片宽高不一致
    console.log("MapAI 输出文本：", responseText);
    console.log("MapAI 生成图片:", base64ImageData.slice(0, 20));
    console.log("MAPAI 图片类型:", mimeType);
    const response2 = await this.landMarkAI.sendMessage(
      responseText,
      base64ImageData,
      mimeType
    );
    return {
      text: response2.text,
      image: base64ImageData,
      mimeType: mimeType,
    };
  }

  async mock(
    message: string,
    base64Image?: string
  ): Promise<{ text: string; image: string; mimeType: string }> {
    const size = 1024;
    const nodeSize = Math.floor(Math.random() * 6 + 1);
    const image: string = await fetchImage2Base64(
      `https://picsum.photos/${size}`
    );
    const generateData = {
      title: "Mock Title",
      nodes: Array.from({ length: nodeSize }, (_, index) => ({
        order: index + 1,
        x: Math.random() * size,
        y: Math.random() * size,
        data: {
          label: `Mock Label ${index + 1}`,
          content: `Mock Content ${index + 1}`,
          lane: `Mock Lane ${index + 1}`,
        },
      })),
    };
    const anchor1 = {
      order: 0,
      x: 0,
      y: 0,
      data: {
        label: "Mock Anchor 1",
        content: "Mock Anchor 1 Content",
        lane: "Mock Anchor 1 Lane",
      },
    };
    const anchor2 = {
      order: nodeSize + 1,
      x: size,
      y: size,
      data: {
        label: "Mock Anchor 2",
        content: "Mock Anchor 2 Content",
        lane: "Mock Anchor 2 Lane",
      },
    };
    generateData.nodes = generateData.nodes.concat(anchor1, anchor2);
    const text = JSON.stringify(generateData);
    return {
      text: text,
      image: image,
      mimeType: DEFAULT_MIME_TYPE,
    };
  }
}

export default new MapAI();
