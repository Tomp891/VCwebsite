import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/VCwebsite/" : "/",
  plugins: [react()],
  server: { host: true, port: 5173, allowedHosts: [".trycloudflare.com", ".loca.lt"] },
});
