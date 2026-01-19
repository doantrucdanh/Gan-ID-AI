
import { GoogleGenAI, Type } from "@google/genai";
import { MAIN_PROMPT, FALLBACK_PROMPT, MODEL_NAME } from "../constants";
import { AIResult, MapIDItem } from "../types";

export class GeminiClient {
  private async callAIWithRetry(prompt: string, useThinking: boolean = false): Promise<AIResult> {
    const storedKey = localStorage.getItem('gemini_api_key');
    const finalKey = storedKey || (process.env.API_KEY as string);

    if (!finalKey) {
      throw new Error("API_KEY_MISSING");
    }
    
    try {
      const ai = new GoogleGenAI({ apiKey: finalKey });
      
      const config: any = {
        temperature: 0.1,
        topP: 0.95,
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

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: { parts: [{ text: prompt }] },
        config
      });

      const text = response.text?.trim() || "{}";
      const parsed = JSON.parse(text);
      if (parsed.muc_do) parsed.muc_do = parsed.muc_do.toUpperCase();
      return parsed;
    } catch (error: any) {
      // Log lỗi chi tiết để debug
      console.error("Gemini API Error:", error);
      
      const status = error?.status;
      const message = error?.message || "";

      // Phân loại lỗi theo mã phản hồi của Google
      if (status === 401 || message.includes("API_KEY_INVALID") || message.includes("401")) {
        throw new Error("API_KEY_INVALID");
      }
      if (status === 429 || message.includes("QUOTA_EXCEEDED") || message.includes("429") || message.includes("limit")) {
        throw new Error("QUOTA_EXCEEDED");
      }
      
      // Nếu là lỗi hệ thống khác, gửi kèm message để user biết
      throw new Error(message || "Lỗi kết nối không xác định");
    }
  }

  public async verifyKey(): Promise<boolean> {
    try {
      await this.callAIWithRetry("Trả về JSON trống {}");
      return true;
    } catch (e: any) {
      if (e.message === "API_KEY_INVALID" || e.message === "QUOTA_EXCEEDED") {
        throw e;
      }
      // Các lỗi khác có thể do prompt verify quá ngắn, vẫn coi như key có thể dùng được
      return true; 
    }
  }

  public async analyze(
    question: string,
    mapidSample: string,
    validCodes: MapIDItem[],
    useThinking: boolean = false
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
        console.warn("Lỗi sửa lỗi ID:", e);
      }
    }

    return { ...result, is_valid: isValid };
  }
}
