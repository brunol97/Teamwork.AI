import {
  getAgentEngineEntry,
  normalizeModelForEngine,
} from "@agent-native/core/agent/engine";
import { describe, expect, it } from "vitest";

import { OLLAMA_ENGINE_NAME, pinOllamaEngineModel } from "../server/llm/agent-chat-model";

const PINNED_MODEL = "gpt-oss:120b";

function pinnedEngine() {
  pinOllamaEngineModel(PINNED_MODEL);
  const entry = getAgentEngineEntry(OLLAMA_ENGINE_NAME)!;
  return { entry, engine: entry.create({ apiKey: "test-key", baseUrl: "https://ollama.com" }) };
}

describe("pinOllamaEngineModel", () => {
  it("offers only the configured model in the chat picker", () => {
    const { entry } = pinnedEngine();
    expect(entry.defaultModel).toBe(PINNED_MODEL);
    expect(entry.supportedModels).toEqual([PINNED_MODEL]);
    expect(entry.acceptsCustomModels).toBe(false);
  });

  it.each(["llama3.1", "llama3.2", "mistral", "codestral"])(
    "maps the request model %s back to the configured model",
    (requestModel) => {
      const { engine } = pinnedEngine();
      expect(normalizeModelForEngine(engine, requestModel)).toBe(PINNED_MODEL);
    },
  );

  it("keeps the configured model when the request sends it", () => {
    const { engine } = pinnedEngine();
    expect(normalizeModelForEngine(engine, PINNED_MODEL)).toBe(PINNED_MODEL);
  });

  it("uses the latest model when it is pinned again", () => {
    pinOllamaEngineModel("gpt-oss:20b");
    const { engine } = pinnedEngine();
    expect(engine.defaultModel).toBe(PINNED_MODEL);
    expect(normalizeModelForEngine(engine, "gpt-oss:20b")).toBe(PINNED_MODEL);
  });
});
