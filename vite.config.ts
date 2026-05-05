import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

function withSanitizedProxyHeaders(proxy: ProxyOptions): ProxyOptions {
  return {
    ...proxy,
    configure(proxyServer) {
      proxyServer.on("proxyReq", (proxyReq) => {
        proxyReq.removeHeader("origin");
        proxyReq.removeHeader("referer");
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const ollamaTarget = env.GEN_BASE_URL || "http://127.0.0.1:11434";
  const backendApiTarget = env.VITE_BACKEND_API_TARGET || "http://127.0.0.1:8008";

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
      proxy: {
        "/api": withSanitizedProxyHeaders({
          target: backendApiTarget,
          changeOrigin: true,
          secure: false,
        }),
        "/__chorus-proxy/sandbox-oauth": withSanitizedProxyHeaders({
          target: "https://sandbox-oauth.piste.gouv.fr",
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/__chorus-proxy\/sandbox-oauth/, ""),
        }),
        "/__chorus-proxy/sandbox-api": withSanitizedProxyHeaders({
          target: "https://sandbox-api.piste.gouv.fr",
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/__chorus-proxy\/sandbox-api/, ""),
        }),
        "/__chorus-proxy/prod-oauth": withSanitizedProxyHeaders({
          target: "https://oauth.piste.gouv.fr",
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/__chorus-proxy\/prod-oauth/, ""),
        }),
        "/__chorus-proxy/prod-api": withSanitizedProxyHeaders({
          target: "https://api.piste.gouv.fr",
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/__chorus-proxy\/prod-api/, ""),
        }),
        "/__chorus-proxy/chorus-qualif": withSanitizedProxyHeaders({
          target: "https://chorus-pro.gouv.fr:5443",
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/__chorus-proxy\/chorus-qualif/, ""),
        }),
        "/__chorus-proxy/chorus-prod": withSanitizedProxyHeaders({
          target: "https://chorus-pro.gouv.fr:5443",
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/__chorus-proxy\/chorus-prod/, ""),
        }),
        "/__gen-proxy/ollama": withSanitizedProxyHeaders({
          target: ollamaTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/__gen-proxy\/ollama/, ""),
        }),
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
