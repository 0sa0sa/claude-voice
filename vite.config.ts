import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // ルート(/)は静的なUI Hub、React版(classic)は /classic.html、
      // VoiceCore(radial)は /radial.html(React+Chakra UI) の3エントリ構成
      input: {
        hub: resolve(__dirname, "index.html"),
        classic: resolve(__dirname, "classic.html"),
        radial: resolve(__dirname, "radial.html"),
      },
    },
  },
  server: {
    port: 5183,
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.CLAUDE_VOICE_API_PORT ?? 8799}`,
        changeOrigin: true,
      },
    },
  },
});
