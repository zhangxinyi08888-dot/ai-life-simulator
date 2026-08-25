import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: process.env.BASE_PATH || '/',
    // Shared finance policy code is also compiled by Taro and reads the
    // TARO_APP_* names.  Replace those exact expressions in the Web bundle so
    // the browser never needs a Node `process` global while both platforms
    // keep the same enforced-by-default policy contract.
    define: {
      'process.env.TARO_APP_FINANCIAL_NODE_GATE_MODE': JSON.stringify(process.env.VITE_FINANCIAL_NODE_GATE_MODE || ''),
      'process.env.TARO_APP_EXPENSE_LIFECYCLE_MODE': JSON.stringify(process.env.VITE_EXPENSE_LIFECYCLE_MODE || ''),
      'process.env.TARO_APP_EXPENSE_NARRATIVE_BINDING_MODE': JSON.stringify(process.env.VITE_EXPENSE_NARRATIVE_BINDING_MODE || '')
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
