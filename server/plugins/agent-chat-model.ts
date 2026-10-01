import { defineNitroPlugin, getAppConfig } from "@agent-native/core/server";

import { pinOllamaEngineModel } from "../llm/agent-chat-model";
import { DEFAULT_OLLAMA_MODEL } from "../llm/ollama";

export default defineNitroPlugin(() => {
  pinOllamaEngineModel(getAppConfig().agent.model ?? DEFAULT_OLLAMA_MODEL);
});
