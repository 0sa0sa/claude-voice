import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
