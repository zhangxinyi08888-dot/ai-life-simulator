export interface ClientGeminiError {
  status: number;
  payload: {
    error: string;
    message: string;
    details?: string;
  };
}

function readErrorText(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isLocationUnsupported(error: unknown): boolean {
  const text = readErrorText(error);
  return text.includes("User location is not supported") || text.includes("FAILED_PRECONDITION");
}

function isModelUnavailable(error: unknown): boolean {
  const text = readErrorText(error);
  return text.includes("is not found for API version") || text.includes("NOT_FOUND");
}

export function selectMostActionableGeminiError(errors: unknown[]): unknown {
  return errors.find(isLocationUnsupported) || errors[errors.length - 1];
}

export function formatGeminiErrorForClient(error: unknown): ClientGeminiError {
  const details = readErrorText(error);

  if (isLocationUnsupported(error)) {
    return {
      status: 400,
      payload: {
        error: "GEMINI_LOCATION_NOT_SUPPORTED",
        message: "当前网络所在地暂不支持 Gemini API 调用。请切换到支持 Gemini API 的网络环境，或改用其他可用的模型服务后再试。",
        details
      }
    };
  }

  if (isModelUnavailable(error)) {
    return {
      status: 502,
      payload: {
        error: "GEMINI_MODEL_UNAVAILABLE",
        message: "当前配置的 Gemini 模型不可用。请检查模型名称或切换到可用模型后重试。",
        details
      }
    };
  }

  return {
    status: 500,
    payload: {
      error: "GEMINI_REQUEST_FAILED",
      message: "AI 生成请求失败，请稍后重试。",
      details
    }
  };
}

