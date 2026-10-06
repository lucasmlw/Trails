import { create } from "zustand";
import type { AppConfig, MapLayerConfig } from "@trails/shared";
import { api } from "../api/client";

const CONFIG_KEY = "trails_config";
const LAYER_KEY = "trails_layer";

const fallbackConfig: AppConfig = {
  appName: "Trails",
  mapLayers: [],
  defaultLayerId: "hike",
  defaultCenter: [-3.05, 54.45],
  defaultZoom: 9,
  offlineZoom: { min: 10, max: 15 },
};

function cached(): AppConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? (JSON.parse(raw) as AppConfig) : null;
  } catch {
    return null;
  }
}

interface ConfigState {
  config: AppConfig;
  loaded: boolean;
  activeLayerId: string;
  load: () => Promise<void>;
  setActiveLayer: (id: string) => void;
  baseLayers: () => MapLayerConfig[];
  layerById: (id: string) => MapLayerConfig | undefined;
}

export const useConfig = create<ConfigState>((set, get) => ({
  config: cached() ?? fallbackConfig,
  loaded: !!cached(),
  activeLayerId: localStorage.getItem(LAYER_KEY) ?? cached()?.defaultLayerId ?? "hike",
  async load() {
    try {
      const config = await api<AppConfig>("/api/config");
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      const active = get().activeLayerId;
      const valid = config.mapLayers.some((l) => l.id === active && l.kind === "base");
      set({ config, loaded: true, activeLayerId: valid ? active : config.defaultLayerId });
    } catch {
      // offline: keep the cached copy
      set({ loaded: true });
    }
  },
  setActiveLayer(id) {
    localStorage.setItem(LAYER_KEY, id);
    set({ activeLayerId: id });
  },
  baseLayers: () => get().config.mapLayers.filter((l) => l.kind === "base"),
  layerById: (id) => get().config.mapLayers.find((l) => l.id === id),
}));
