import { defineAppConfig } from "@agent-native/core/server";
import { DEFAULT_OLLAMA_MODEL } from "../llm/ollama";

export default defineAppConfig({
  app: {
    id: "agent-office",
    name: "Agent Office",
    sourceTemplate: "chat",
    homePath: "/home",
  },
  agent: {
    engine: "ai-sdk:ollama",
    model: process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL,
    builtInEngines: ["ai-sdk:ollama"],
  },
});
