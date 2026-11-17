import { create } from "zustand";
import { api, errorMessage } from "../lib/bridge";
import { applyTheme } from "../lib/utils";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type ConnectorInfo,
  type GithubInfo,
  type Memory,
  type Project,
  type ProviderConfig,
  type Theme,
} from "../types";
import { pushToast } from "./toast";
import { useChatStore } from "./chat";

const SETTINGS_KEY = "app.settings";

export type SettingsSection =
  | "general"
  | "model"
  | "connectors"
  | "memory"
  | "usage"
  | "data"
  | "about"
  | "developer";

export type View =
  | { name: "chat" }
  | { name: "projects"; projectId: string | null }
  | { name: "settings"; section: SettingsSection };

interface AppStore {
  ready: boolean;
  fatalError: string | null;
  needsOnboarding: boolean;
  onboardingReason: "first-run" | "missing-key";
  settings: AppSettings;
  providers: ProviderConfig[];
  keyPresent: Record<string, boolean>;
  projects: Project[];
  memories: Memory[];
  connectors: ConnectorInfo[];
  github: GithubInfo | null;
  view: View;

  init: () => Promise<void>;
  setView: (view: View) => void;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
  setModel: (providerId: string, modelId: string) => Promise<void>;
  refreshProviders: () => Promise<void>;
  refreshKeyStatus: () => Promise<void>;
  saveProviders: (providers: ProviderConfig[]) => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshMemories: () => Promise<void>;
  refreshConnectors: () => Promise<void>;
  refreshGithub: () => Promise<void>;
  finishOnboarding: (patch: Partial<AppSettings>) => Promise<void>;
  requestOnboarding: (reason: "first-run" | "missing-key") => void;
}

async function loadConnectors(connect: boolean) {
  try {
    const list = await api.connectorsGet();
    useAppStore.setState({ connectors: list });
    if (connect && list.some((c) => c.config.enabled)) {
      await api.connectorsConnectAll();
      window.setTimeout(() => void useAppStore.getState().refreshConnectors(), 1200);
      window.setTimeout(() => void useAppStore.getState().refreshConnectors(), 4500);
    }
  } catch {
    /* connectors are optional */
  }
}

function parseSettings(raw: Record<string, string>): AppSettings {
  try {
    const stored = raw[SETTINGS_KEY];
    if (!stored) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(stored) as Partial<AppSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export const useAppStore = create<AppStore>((set, get) => ({
  ready: false,
  fatalError: null,
  needsOnboarding: true,
  onboardingReason: "first-run",
  settings: { ...DEFAULT_SETTINGS },
  providers: [],
  keyPresent: {},
  projects: [],
  memories: [],
  connectors: [],
  github: null,
  view: { name: "chat" },

  init: async () => {
    try {
      const raw = await api.settingsGetAll();
      let settings = parseSettings(raw);
      applyTheme(settings.theme);

      const providers = await api.providersGet();
      const statuses = await Promise.all(
        providers.map(async (p) => [p.id, await api.credentialStatus(p.id)] as const),
      );
      const keyPresent = Object.fromEntries(statuses);

      const originalSelection = `${settings.providerId}::${settings.modelId}`;
      let current = providers.find((p) => p.id === settings.providerId) ?? providers[0];
      if (current && !current.models.some((m) => m.id === settings.modelId)) {
        settings = {
          ...settings,
          providerId: current.id,
          modelId: current.models[0]?.id ?? settings.modelId,
        };
      }
      if (`${settings.providerId}::${settings.modelId}` !== originalSelection) {
        try {
          await api.settingsSet(SETTINGS_KEY, JSON.stringify(settings));
        } catch {
          /* non-fatal: the in-memory selection is still valid */
        }
      }

      let needsOnboarding = !settings.onboarded;
      let reason: "first-run" | "missing-key" = "first-run";
      if (!needsOnboarding && !settings.demoMode) {
        if (!current || !keyPresent[current.id]) {
          needsOnboarding = true;
          reason = "missing-key";
        }
      }

      set({
        ready: true,
        settings,
        providers,
        keyPresent,
        needsOnboarding,
        onboardingReason: needsOnboarding ? reason : "first-run",
      });

      if (!needsOnboarding) {
        await useChatStore.getState().bootstrap();
        await get().refreshProjects();
        await get().refreshMemories();
        await loadConnectors(settings.connectors);
        await get().refreshGithub();
      }
    } catch (err) {
      set({ ready: true, fatalError: errorMessage(err) });
    }
  },

  setView: (view) => set({ view }),

  updateSettings: async (patch) => {
    const prev = get().settings;
    const next = { ...prev, ...patch };
    set({ settings: next });
    if (patch.theme && patch.theme !== prev.theme) applyTheme(next.theme);
    try {
      await api.settingsSet(SETTINGS_KEY, JSON.stringify(next));
      if (patch.connectors === true) void loadConnectors(true);
    } catch (err) {
      pushToast({ kind: "error", title: "设置保存失败", detail: errorMessage(err) });
    }
  },

  setTheme: async (theme) => {
    applyTheme(theme);
    await get().updateSettings({ theme });
  },

  setModel: async (providerId, modelId) => {
    await get().updateSettings({ providerId, modelId });
    const chat = useChatStore.getState();
    if (chat.activeId) await chat.setConversationModel(chat.activeId, modelId);
  },

  refreshProviders: async () => {
    const providers = await api.providersGet();
    const statuses = await Promise.all(
      providers.map(async (p) => [p.id, await api.credentialStatus(p.id)] as const),
    );
    set({ providers, keyPresent: Object.fromEntries(statuses) });
  },

  refreshKeyStatus: async () => {
    const providers = get().providers;
    const statuses = await Promise.all(
      providers.map(async (p) => [p.id, await api.credentialStatus(p.id)] as const),
    );
    set({ keyPresent: Object.fromEntries(statuses) });
  },

  saveProviders: async (list) => {
    await api.providersSave(list);
    await get().refreshProviders();
    const { settings, providers } = get();
    const current = providers.find((p) => p.id === settings.providerId);
    if (!current) {
      const first = providers[0];
      if (first) await get().updateSettings({ providerId: first.id, modelId: first.models[0]?.id ?? "" });
    } else if (!current.models.some((m) => m.id === settings.modelId)) {
      await get().updateSettings({ modelId: current.models[0]?.id ?? "" });
    }
  },

  refreshProjects: async () => {
    try {
      set({ projects: await api.listProjects() });
    } catch {
      /* non-fatal */
    }
  },

  refreshMemories: async () => {
    try {
      set({ memories: await api.listMemories() });
    } catch {
      /* non-fatal */
    }
  },

  refreshConnectors: async () => {
    try {
      set({ connectors: await api.connectorsGet() });
    } catch {
      /* non-fatal */
    }
  },

  refreshGithub: async () => {
    try {
      set({ github: await api.githubGet() });
    } catch {
      /* non-fatal */
    }
  },

  finishOnboarding: async (patch) => {
    const next: AppSettings = {
      ...get().settings,
      ...patch,
      onboarded: true,
    };
    set({ settings: next, needsOnboarding: false, view: { name: "chat" } });
    applyTheme(next.theme);
    try {
      await api.settingsSet(SETTINGS_KEY, JSON.stringify(next));
    } catch (err) {
      pushToast({ kind: "error", title: "设置保存失败", detail: errorMessage(err) });
    }
    await get().refreshProviders();
    await get().refreshKeyStatus();
    await useChatStore.getState().bootstrap();
    await get().refreshProjects();
    await get().refreshMemories();
    await loadConnectors(next.connectors);
    await get().refreshGithub();
  },

  requestOnboarding: (reason) =>
    set({ needsOnboarding: true, onboardingReason: reason }),
}));

function currentProvider(): ProviderConfig | undefined {
  const { providers, settings } = useAppStore.getState();
  return providers.find((p) => p.id === settings.providerId) ?? providers[0];
}

export function currentModel() {
  const provider = currentProvider();
  return provider?.models.find((m) => m.id === useAppStore.getState().settings.modelId);
}

export function modelLabel(modelId?: string | null): string {
  if (!modelId) return "";
  const clean = modelId.replace(/^demo:/, "");
  for (const provider of useAppStore.getState().providers) {
    const model = provider.models.find((m) => m.id === clean);
    if (model) return model.label;
  }
  return clean;
}

export function systemThemeListener() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    if (useAppStore.getState().settings.theme === "system") applyTheme("system");
  };
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
