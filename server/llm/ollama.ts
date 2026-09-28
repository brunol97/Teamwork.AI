import { generateText } from "ai";
import { createOllama } from "ai-sdk-ollama";

export interface OllamaMessage {
  role: "user" | "assistant";
  content: string;
}

export async function generateOllamaResponse(
  system: string,
  messages: OllamaMessage[],
  options?: {
    baseURL?: string;
    apiKey?: string;
    model?: string;
  },
): Promise<string> {
  if (process.env.AGENT_OFFICE_MOCK_LLM_RESPONSE) {
    return process.env.AGENT_OFFICE_MOCK_LLM_RESPONSE;
  }

  const baseURL = options?.baseURL ?? process.env.OLLAMA_BASE_URL;
  const apiKey = options?.apiKey ?? process.env.OLLAMA_API_KEY;
  const model = options?.model ?? "llama3.2";

  if (!baseURL) {
    throw new Error(
      "OLLAMA_BASE_URL is not configured. Set it in your environment to use the local Ollama endpoint.",
    );
  }

  const ollama = createOllama({
    baseURL,
    apiKey,
  });

  const { text } = await generateText({
    model: ollama(model),
    system,
    messages,
  });

  return text;
}
