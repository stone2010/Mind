import type { ProviderConfig } from "../types";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export const DEFAULT_DEEPSEEK_PROVIDER: ProviderConfig = {
  id: "deepseek",
  name: "DeepSeek",
  kind: "deepseek",
  baseUrl: DEEPSEEK_BASE_URL,
  isBuiltin: true,
  models: [
    {
      id: "deepseek-flash",
      label: "DeepSeek Flash",
      supportsThinking: true,
      supportsVision: true,
      supportsWebSearch: true,
      temperature: null,
      maxTokens: null,
    },
    {
      id: "deepseek-v4-pro",
      label: "DeepSeek V4 Pro",
      supportsThinking: true,
      supportsVision: false,
      supportsWebSearch: false,
      temperature: null,
      maxTokens: null,
    },
  ],
};
