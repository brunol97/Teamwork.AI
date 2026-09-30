import { generateText } from "ai";
import { createOllama } from "ai-sdk-ollama";

export interface OllamaMessage {
  role: "user" | "assistant";
  content: string;
}

import { DEFAULT_AGENT_MODEL } from "../../shared/agents/templates.js";

export const DEFAULT_OLLAMA_MODEL = DEFAULT_AGENT_MODEL;

/**
 * `ai-sdk-ollama` appends `/api/chat` to the base URL itself, so the base URL is
 * the server root — `https://ollama.com`, not `https://ollama.com/api`. Earlier
 * revisions of `.env.example` and the Vercel project used the `/api` form, so we
 * tolerate and normalise it instead of failing with `path "/api/api/chat" not found`.
 */
export function normalizeOllamaBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").replace(/\/api$/, "");
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

  const rawBaseURL = options?.baseURL ?? process.env.OLLAMA_BASE_URL;
  const apiKey = options?.apiKey ?? process.env.OLLAMA_API_KEY;
  const model = options?.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;

  if (!rawBaseURL) {
    throw new Error(
      "OLLAMA_BASE_URL is not configured. Use the server root: https://ollama.com for Ollama Cloud, or http://localhost:11434 for a local Ollama.",
    );
  }

  const baseURL = normalizeOllamaBaseUrl(rawBaseURL);

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
