/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FINANCIAL_NODE_GATE_MODE?: "off" | "shadow" | "enforced";
  readonly VITE_EXPENSE_LIFECYCLE_MODE?: "off" | "shadow" | "enforced";
  readonly VITE_DEEPSEEK_API_KEY?: string;
  readonly VITE_DEEPSEEK_BASE_URL?: string;
  readonly VITE_DEEPSEEK_MODEL?: string;
  readonly VITE_ENABLE_CANDIDATE_PATCH_REPAIR?: string;
  readonly VITE_RELEASE_CANDIDATE_ID?: string;
  readonly VITE_RELEASE_SOURCE_COMMIT?: string;
  readonly VITE_RELEASE_RUNTIME_FINGERPRINT?: string;
  readonly VITE_RELEASE_COLLECTOR_FINGERPRINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
