/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEEPSEEK_API_KEY?: string;
  readonly VITE_DEEPSEEK_BASE_URL?: string;
  readonly VITE_DEEPSEEK_MODEL?: string;
  readonly VITE_ENABLE_CANDIDATE_PATCH_REPAIR?: string;
  readonly VITE_CACHE_AWARE_PROMPT_V1?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
