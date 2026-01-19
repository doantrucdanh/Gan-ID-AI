
import { GoogleGenAI, Type } from "@google/genai";
import { MAIN_PROMPT, FALLBACK_PROMPT, MODEL_NAME } from "../constants";
import { AIResult, MapIDItem } from "../types";

export class GeminiClient {
  private maxRetries = 3;

  private getAI() {
    return new GoogleGenAI({ apiKey: process.env.API_KEY as string });
  }

  async testConnection(): Promise<boolean> {
    try {
      const ai = this.getAI();
      await ai.models.generateContent({
        model: MODEL_NAME,
        contents: "ping",
      });
      return true;
    } catch (e) {
      console.error("Connection test failed:", e);
      return false;
    }
  }

  private async callAIWithRetry(prompt: string, useThinking: boolean = true): Promise<AIResult> {
    let lastError: any;
    const ai = this.getAI();
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
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
          // Gemini 3 and 2.5 support thinkingConfig
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
      
      const fallbackResult = await this.callAIWithRetry(prompt2, useThinking);
      if (checkValidity(fallbackResult)) {
        result = fallbackResult;
        isValid = true;
      }
    }

    return { ...result, is_valid: isValid };
  }
}
