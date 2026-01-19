
import { GoogleGenAI, Type } from "@google/genai";
import { MAIN_PROMPT, FALLBACK_PROMPT, MODEL_NAME } from "../constants";
import { AIResult, MapIDItem } from "../types";

export class GeminiClient {
  private maxRetries = 2;

  private async callAIWithRetry(prompt: string, useThinking: boolean = true): Promise<AIResult> {
    let lastError: any;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        // Tạo instance mới mỗi lần gọi để đảm bảo lấy API key mới nhất từ môi trường
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
        
        const config: any = {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              lop: { type: Type.STRING },
              mon: { type: Type.STRING },
              chuong: { type: Type.STRING },
              bai: { type: Type.STRING },
              dang: { type: Type.STRING },
              muc_do: { type: Type.STRING },
              do_tin_cay: { type: Type.NUMBER }
            },
            required: ["lop", "mon", "chuong", "bai", "dang", "muc_do", "do_tin_cay"]
          }
        };

        if (useThinking) {
          config.thinkingConfig = { thinkingBudget: 4000 };
        }

        const response = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: prompt,
          config
        });

        const text = response.text?.trim() || "{}";
        return JSON.parse(text);
      } catch (error: any) {
        lastError = error;
        
        // Kiểm tra lỗi đặc thù khi API Key không hợp lệ hoặc project không tìm thấy
        if (error?.message?.includes("Requested entity was not found")) {
          throw new Error("API_KEY_INVALID");
        }

        const delay = error?.status === 429 ? 5000 : 2000;
        if (attempt < this.maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }

  public async analyze(
    question: string,
    mapidSample: string,
    validCodes: MapIDItem[],
    useThinking: boolean = true
  ): Promise<AIResult> {
    const prompt1 = MAIN_PROMPT.replace('{q}', question).replace('{mapid_sample}', mapidSample);
    let result = await this.callAIWithRetry(prompt1, useThinking);

    const checkValidity = (res: AIResult) => 
      validCodes.some(c => 
        c.lop === res.lop && 
        c.mon === res.mon && 
        c.chuong === res.chuong && 
        c.bai === res.bai && 
        c.dang === res.dang
      );

    let isValid = checkValidity(result);

    if (!isValid) {
      const prompt2 = FALLBACK_PROMPT
        .replace('{q}', question)
        .replace('{mapid_sample}', mapidSample)
        .replace('{old}', JSON.stringify(result));
      
      try {
        const fallbackResult = await this.callAIWithRetry(prompt2, useThinking);
        if (checkValidity(fallbackResult)) {
          result = fallbackResult;
          isValid = true;
        }
      } catch (e) {
        console.warn("Fallback check failed:", e);
      }
    }

    return { ...result, is_valid: isValid };
  }
}
