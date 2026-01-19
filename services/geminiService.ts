
import { GoogleGenAI, Type } from "@google/genai";
import { MAIN_PROMPT, FALLBACK_PROMPT, MODEL_NAME } from "../constants";
import { AIResult, MapIDItem } from "../types";

export class GeminiClient {
  private maxRetries = 3;

  private async callAIWithRetry(prompt: string, useThinking: boolean = true): Promise<AIResult> {
    let lastError: any;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        // Khởi tạo instance ngay trước khi thực hiện cuộc gọi để đảm bảo 
        // luôn sử dụng cấu hình mới nhất từ môi trường thực thi.
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
          // Kích hoạt chế độ suy nghĩ (Thinking Mode) để tăng độ chính xác cho câu hỏi phức tạp
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
        // Xử lý lỗi Rate Limit (429) hoặc lỗi kết nối tạm thời
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

    // Kiểm tra tính hợp lệ của mã ID do AI trả về so với danh sách MapID đã nạp
    const checkValidity = (res: AIResult) => 
      validCodes.some(c => 
        c.lop === res.lop && 
        c.mon === res.mon && 
        c.chuong === res.chuong && 
        c.bai === res.bai && 
        c.dang === res.dang
      );

    let isValid = checkValidity(result);

    // Nếu mã không khớp chính xác, thực hiện một bước kiểm tra (Fallback) để điều chỉnh
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
