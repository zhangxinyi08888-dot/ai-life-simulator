/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FINANCIAL_NODE_GATE_MODE?: "off" | "shadow" | "enforced";
  readonly VITE_DEEPSEEK_API_KEY?: string;
  readonly VITE_DEEPSEEK_BASE_URL?: string;
  readonly VITE_DEEPSEEK_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
