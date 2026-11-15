
import { defineConfig, loadEnv } from "vite";
import { cwd } from "node:process";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, cwd(), "VITE_");
  if (env.VITE_APP_ENV && !["staging", "production"].includes(env.VITE_APP_ENV))
    throw new Error("Unsupported hosted frontend environment");
  if (env.VITE_APP_ENV === "production" && env.VITE_ENABLE_STRIPE_CHECKOUT === "true")
    throw new Error("Production checkout remains disabled until the live-payment rollout is validated");
  return {
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true
      }
    }
  }
  };
});
