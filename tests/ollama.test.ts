import { describe, expect, it } from "vitest";
import { DEFAULT_OLLAMA_MODEL, normalizeOllamaBaseUrl } from "../server/llm/ollama";

describe("normalizeOllamaBaseUrl", () => {
  it("keeps a plain server root", () => {
    expect(normalizeOllamaBaseUrl("https://ollama.com")).toBe("https://ollama.com");
  });

  it("keeps a local Ollama root", () => {
    expect(normalizeOllamaBaseUrl("http://localhost:11434")).toBe("http://localhost:11434");
  });

  it("strips a trailing /api because the provider appends /api/chat", () => {
    expect(normalizeOllamaBaseUrl("https://ollama.com/api")).toBe("https://ollama.com");
  });

  it("strips trailing slashes and an /api suffix together", () => {
    expect(normalizeOllamaBaseUrl("https://ollama.com/api/")).toBe("https://ollama.com");
    expect(normalizeOllamaBaseUrl("  https://ollama.com/api  ")).toBe("https://ollama.com");
  });

  it("never produces the doubled /api/api path", () => {
    const base = normalizeOllamaBaseUrl("https://ollama.com/api");
    expect(`${base}/api/chat`).toBe("https://ollama.com/api/chat");
  });
});

describe("DEFAULT_OLLAMA_MODEL", () => {
  it("is a model that exists on Ollama Cloud", () => {
    expect(DEFAULT_OLLAMA_MODEL).toBe("gpt-oss:120b");
  });
});
