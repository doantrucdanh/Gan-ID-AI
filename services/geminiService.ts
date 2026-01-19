
import { GoogleGenAI, Type } from "@google/genai";
import { MAIN_PROMPT, FALLBACK_PROMPT, MODEL_NAME } from "../constants";
import { AIResult, MapIDItem } from "../types";

export class GeminiClient {
  private maxRetries = 2;

  private async callAIWithRetry(prompt: string, useThinking: boolean = false): Promise<AIResult> {
    const storedKey = localStorage.getItem('gemini_api_key');
    const finalKey = storedKey || (process.env.API_KEY as string);

    if (!finalKey) {
      throw new Error("API_KEY_MISSING");
    }
    
    let lastError: any;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const ai = new GoogleGenAI({ apiKey: finalKey });
        
        const config: any = {
          temperature: 0.1, // Giữ nhiệt độ thấp để AI phản hồi ổn định, không sáng tạo lung tung
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
        
        // Chuẩn hóa muc_do về in hoa
        if (parsed.muc_do) parsed.muc_do = parsed.muc_do.toUpperCase();
        
        return parsed;
      } catch (error: any) {
        lastError = error;
        const errorMsg = error?.message || "";
        
        if (error?.status === 401 || errorMsg.includes("API key not valid")) {
          throw new Error("API_KEY_INVALID");
        }
        
        // Nếu lỗi quá tải (429) thì chờ lâu hơn
        const delay = error?.status === 429 ? 4000 : 1500;
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
    useThinking: boolean = false
  ): Promise<AIResult> {
    const prompt1 = MAIN_PROMPT.replace('{q}', question).replace('{mapid_sample}', mapidSample);
    let result = await this.callAIWithRetry(prompt1, useThinking);

    // Hàm kiểm tra xem bộ mã AI trả về có thực sự tồn tại trong file MapID không
    const checkValidity = (res: AIResult) => 
      validCodes.some(c => 
        c.lop === res.lop && 
        c.mon === res.mon && 
        c.chuong === res.chuong && 
        c.bai === res.bai && 
        c.dang === res.dang
      );

    let isValid = checkValidity(result);

    // Nếu không khớp, thực hiện bước Fallback để AI sửa lỗi dựa trên danh sách chuẩn
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
        console.warn("Lỗi khi thực hiện bước sửa lỗi ID:", e);
      }
    }

    return { ...result, is_valid: isValid };
  }
}
