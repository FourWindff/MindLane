import { GoogleGenAI } from "@google/genai";
import { GEMINI_TYPE } from "./types";

export abstract class GeminiAI {
  protected genAI: GoogleGenAI;
  protected modelName: string;

  constructor(modelName: GEMINI_TYPE) {
    const key = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    if (!key) {
      throw new Error(
        "Gemini API key not found. Ensure GEMINI_API_KEY is set in your environment and accessible via app.config.js extra.geminiApiKey."
      );
    }
    this.genAI = new GoogleGenAI({ vertexai: false, apiKey: key });
    this.modelName = modelName;
  }


  abstract sendMessage(
    message?: string,
    base64Image?: string
  ): Promise<{ text?: string; image?: string }>;
}
