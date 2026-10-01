import {
  getAgentEngineEntry,
  registerBuiltinEngines,
} from "@agent-native/core/agent/engine";
import type { AgentEngineEntry } from "@agent-native/core/agent/engine";

export const OLLAMA_ENGINE_NAME = "ai-sdk:ollama";

const originalCreate = new WeakMap<AgentEngineEntry, AgentEngineEntry["create"]>();

/**
 * The framework's `ai-sdk:ollama` entry defaults to `llama3.1` and offers only
 * local models (`llama3.1`, `llama3.2`, `mistral`, `codestral`). Ollama Cloud
 * serves none of them, and the agent chat sends the picked model with every
 * request, which wins over `agent.model`. So the entry is pinned to the one
 * model this deployment serves: the chat picker offers only that model, and
 * the engine refuses custom models, so it maps any other request model back to
 * the pinned model.
 *
 * `registerBuiltinEngines` runs first so that its later calls are no-ops and do
 * not replace the pinned entry with a fresh one.
 */
export function pinOllamaEngineModel(model: string): void {
  registerBuiltinEngines();
  const entry = getAgentEngineEntry(OLLAMA_ENGINE_NAME);
  if (!entry) return;

  const create = originalCreate.get(entry) ?? entry.create;
  originalCreate.set(entry, create);

  entry.defaultModel = model;
  entry.supportedModels = [model];
  entry.acceptsCustomModels = false;
  entry.create = (config) =>
    create({
      ...config,
      model,
      supportedModels: [model],
      acceptsCustomModels: false,
    });
}
