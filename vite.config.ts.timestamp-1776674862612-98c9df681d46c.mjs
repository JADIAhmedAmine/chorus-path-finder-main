// vite.config.ts
import { defineConfig, loadEnv } from "file:///mnt/c/Users/ahmed-amine.jadi/chorus-path-finder-main/node_modules/vite/dist/node/index.js";
import react from "file:///mnt/c/Users/ahmed-amine.jadi/chorus-path-finder-main/node_modules/@vitejs/plugin-react-swc/index.js";
import path from "path";
import { componentTagger } from "file:///mnt/c/Users/ahmed-amine.jadi/chorus-path-finder-main/node_modules/lovable-tagger/dist/index.js";
var __vite_injected_original_dirname = "/mnt/c/Users/ahmed-amine.jadi/chorus-path-finder-main";
function withSanitizedProxyHeaders(proxy) {
  return {
    ...proxy,
    configure(proxyServer) {
      proxyServer.on("proxyReq", (proxyReq) => {
        proxyReq.removeHeader("origin");
        proxyReq.removeHeader("referer");
      });
    }
  };
}
var vite_config_default = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const ollamaTarget = env.GEN_BASE_URL || "http://127.0.0.1:11434";
  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false
      },
      proxy: {
        "/__chorus-proxy/sandbox-oauth": withSanitizedProxyHeaders({
          target: "https://sandbox-oauth.piste.gouv.fr",
          changeOrigin: true,
          secure: true,
          rewrite: (path2) => path2.replace(/^\/__chorus-proxy\/sandbox-oauth/, "")
        }),
        "/__chorus-proxy/sandbox-api": withSanitizedProxyHeaders({
          target: "https://sandbox-api.piste.gouv.fr",
          changeOrigin: true,
          secure: true,
          rewrite: (path2) => path2.replace(/^\/__chorus-proxy\/sandbox-api/, "")
        }),
        "/__chorus-proxy/chorus-qualif": withSanitizedProxyHeaders({
          target: "https://chorus-pro.gouv.fr:5443",
          changeOrigin: true,
          secure: true,
          rewrite: (path2) => path2.replace(/^\/__chorus-proxy\/chorus-qualif/, "")
        }),
        "/__gen-proxy/ollama": withSanitizedProxyHeaders({
          target: ollamaTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path2) => path2.replace(/^\/__gen-proxy\/ollama/, "")
        })
      }
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__vite_injected_original_dirname, "./src")
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"]
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvbW50L2MvVXNlcnMvYWhtZWQtYW1pbmUuamFkaS9jaG9ydXMtcGF0aC1maW5kZXItbWFpblwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL21udC9jL1VzZXJzL2FobWVkLWFtaW5lLmphZGkvY2hvcnVzLXBhdGgtZmluZGVyLW1haW4vdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL21udC9jL1VzZXJzL2FobWVkLWFtaW5lLmphZGkvY2hvcnVzLXBhdGgtZmluZGVyLW1haW4vdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcsIGxvYWRFbnYsIHR5cGUgUHJveHlPcHRpb25zIH0gZnJvbSBcInZpdGVcIjtcbmltcG9ydCByZWFjdCBmcm9tIFwiQHZpdGVqcy9wbHVnaW4tcmVhY3Qtc3djXCI7XG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgY29tcG9uZW50VGFnZ2VyIH0gZnJvbSBcImxvdmFibGUtdGFnZ2VyXCI7XG5cbmZ1bmN0aW9uIHdpdGhTYW5pdGl6ZWRQcm94eUhlYWRlcnMocHJveHk6IFByb3h5T3B0aW9ucyk6IFByb3h5T3B0aW9ucyB7XG4gIHJldHVybiB7XG4gICAgLi4ucHJveHksXG4gICAgY29uZmlndXJlKHByb3h5U2VydmVyKSB7XG4gICAgICBwcm94eVNlcnZlci5vbihcInByb3h5UmVxXCIsIChwcm94eVJlcSkgPT4ge1xuICAgICAgICBwcm94eVJlcS5yZW1vdmVIZWFkZXIoXCJvcmlnaW5cIik7XG4gICAgICAgIHByb3h5UmVxLnJlbW92ZUhlYWRlcihcInJlZmVyZXJcIik7XG4gICAgICB9KTtcbiAgICB9LFxuICB9O1xufVxuXG4vLyBodHRwczovL3ZpdGVqcy5kZXYvY29uZmlnL1xuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKCh7IG1vZGUgfSkgPT4ge1xuICBjb25zdCBlbnYgPSBsb2FkRW52KG1vZGUsIHByb2Nlc3MuY3dkKCksIFwiXCIpO1xuICBjb25zdCBvbGxhbWFUYXJnZXQgPSBlbnYuR0VOX0JBU0VfVVJMIHx8IFwiaHR0cDovLzEyNy4wLjAuMToxMTQzNFwiO1xuXG4gIHJldHVybiB7XG4gICAgc2VydmVyOiB7XG4gICAgICBob3N0OiBcIjo6XCIsXG4gICAgICBwb3J0OiA4MDgwLFxuICAgICAgaG1yOiB7XG4gICAgICAgIG92ZXJsYXk6IGZhbHNlLFxuICAgICAgfSxcbiAgICAgIHByb3h5OiB7XG4gICAgICAgIFwiL19fY2hvcnVzLXByb3h5L3NhbmRib3gtb2F1dGhcIjogd2l0aFNhbml0aXplZFByb3h5SGVhZGVycyh7XG4gICAgICAgICAgdGFyZ2V0OiBcImh0dHBzOi8vc2FuZGJveC1vYXV0aC5waXN0ZS5nb3V2LmZyXCIsXG4gICAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxuICAgICAgICAgIHNlY3VyZTogdHJ1ZSxcbiAgICAgICAgICByZXdyaXRlOiAocGF0aCkgPT4gcGF0aC5yZXBsYWNlKC9eXFwvX19jaG9ydXMtcHJveHlcXC9zYW5kYm94LW9hdXRoLywgXCJcIiksXG4gICAgICAgIH0pLFxuICAgICAgICBcIi9fX2Nob3J1cy1wcm94eS9zYW5kYm94LWFwaVwiOiB3aXRoU2FuaXRpemVkUHJveHlIZWFkZXJzKHtcbiAgICAgICAgICB0YXJnZXQ6IFwiaHR0cHM6Ly9zYW5kYm94LWFwaS5waXN0ZS5nb3V2LmZyXCIsXG4gICAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxuICAgICAgICAgIHNlY3VyZTogdHJ1ZSxcbiAgICAgICAgICByZXdyaXRlOiAocGF0aCkgPT4gcGF0aC5yZXBsYWNlKC9eXFwvX19jaG9ydXMtcHJveHlcXC9zYW5kYm94LWFwaS8sIFwiXCIpLFxuICAgICAgICB9KSxcbiAgICAgICAgXCIvX19jaG9ydXMtcHJveHkvY2hvcnVzLXF1YWxpZlwiOiB3aXRoU2FuaXRpemVkUHJveHlIZWFkZXJzKHtcbiAgICAgICAgICB0YXJnZXQ6IFwiaHR0cHM6Ly9jaG9ydXMtcHJvLmdvdXYuZnI6NTQ0M1wiLFxuICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcbiAgICAgICAgICBzZWN1cmU6IHRydWUsXG4gICAgICAgICAgcmV3cml0ZTogKHBhdGgpID0+IHBhdGgucmVwbGFjZSgvXlxcL19fY2hvcnVzLXByb3h5XFwvY2hvcnVzLXF1YWxpZi8sIFwiXCIpLFxuICAgICAgICB9KSxcbiAgICAgICAgXCIvX19nZW4tcHJveHkvb2xsYW1hXCI6IHdpdGhTYW5pdGl6ZWRQcm94eUhlYWRlcnMoe1xuICAgICAgICAgIHRhcmdldDogb2xsYW1hVGFyZ2V0LFxuICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcbiAgICAgICAgICBzZWN1cmU6IGZhbHNlLFxuICAgICAgICAgIHJld3JpdGU6IChwYXRoKSA9PiBwYXRoLnJlcGxhY2UoL15cXC9fX2dlbi1wcm94eVxcL29sbGFtYS8sIFwiXCIpLFxuICAgICAgICB9KSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBwbHVnaW5zOiBbcmVhY3QoKSwgbW9kZSA9PT0gXCJkZXZlbG9wbWVudFwiICYmIGNvbXBvbmVudFRhZ2dlcigpXS5maWx0ZXIoQm9vbGVhbiksXG4gICAgcmVzb2x2ZToge1xuICAgICAgYWxpYXM6IHtcbiAgICAgICAgXCJAXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmNcIiksXG4gICAgICB9LFxuICAgICAgZGVkdXBlOiBbXCJyZWFjdFwiLCBcInJlYWN0LWRvbVwiLCBcInJlYWN0L2pzeC1ydW50aW1lXCIsIFwicmVhY3QvanN4LWRldi1ydW50aW1lXCIsIFwiQHRhbnN0YWNrL3JlYWN0LXF1ZXJ5XCIsIFwiQHRhbnN0YWNrL3F1ZXJ5LWNvcmVcIl0sXG4gICAgfSxcbiAgfTtcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFpVixTQUFTLGNBQWMsZUFBa0M7QUFDMVksT0FBTyxXQUFXO0FBQ2xCLE9BQU8sVUFBVTtBQUNqQixTQUFTLHVCQUF1QjtBQUhoQyxJQUFNLG1DQUFtQztBQUt6QyxTQUFTLDBCQUEwQixPQUFtQztBQUNwRSxTQUFPO0FBQUEsSUFDTCxHQUFHO0FBQUEsSUFDSCxVQUFVLGFBQWE7QUFDckIsa0JBQVksR0FBRyxZQUFZLENBQUMsYUFBYTtBQUN2QyxpQkFBUyxhQUFhLFFBQVE7QUFDOUIsaUJBQVMsYUFBYSxTQUFTO0FBQUEsTUFDakMsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNGO0FBQ0Y7QUFHQSxJQUFPLHNCQUFRLGFBQWEsQ0FBQyxFQUFFLEtBQUssTUFBTTtBQUN4QyxRQUFNLE1BQU0sUUFBUSxNQUFNLFFBQVEsSUFBSSxHQUFHLEVBQUU7QUFDM0MsUUFBTSxlQUFlLElBQUksZ0JBQWdCO0FBRXpDLFNBQU87QUFBQSxJQUNMLFFBQVE7QUFBQSxNQUNOLE1BQU07QUFBQSxNQUNOLE1BQU07QUFBQSxNQUNOLEtBQUs7QUFBQSxRQUNILFNBQVM7QUFBQSxNQUNYO0FBQUEsTUFDQSxPQUFPO0FBQUEsUUFDTCxpQ0FBaUMsMEJBQTBCO0FBQUEsVUFDekQsUUFBUTtBQUFBLFVBQ1IsY0FBYztBQUFBLFVBQ2QsUUFBUTtBQUFBLFVBQ1IsU0FBUyxDQUFDQSxVQUFTQSxNQUFLLFFBQVEsb0NBQW9DLEVBQUU7QUFBQSxRQUN4RSxDQUFDO0FBQUEsUUFDRCwrQkFBK0IsMEJBQTBCO0FBQUEsVUFDdkQsUUFBUTtBQUFBLFVBQ1IsY0FBYztBQUFBLFVBQ2QsUUFBUTtBQUFBLFVBQ1IsU0FBUyxDQUFDQSxVQUFTQSxNQUFLLFFBQVEsa0NBQWtDLEVBQUU7QUFBQSxRQUN0RSxDQUFDO0FBQUEsUUFDRCxpQ0FBaUMsMEJBQTBCO0FBQUEsVUFDekQsUUFBUTtBQUFBLFVBQ1IsY0FBYztBQUFBLFVBQ2QsUUFBUTtBQUFBLFVBQ1IsU0FBUyxDQUFDQSxVQUFTQSxNQUFLLFFBQVEsb0NBQW9DLEVBQUU7QUFBQSxRQUN4RSxDQUFDO0FBQUEsUUFDRCx1QkFBdUIsMEJBQTBCO0FBQUEsVUFDL0MsUUFBUTtBQUFBLFVBQ1IsY0FBYztBQUFBLFVBQ2QsUUFBUTtBQUFBLFVBQ1IsU0FBUyxDQUFDQSxVQUFTQSxNQUFLLFFBQVEsMEJBQTBCLEVBQUU7QUFBQSxRQUM5RCxDQUFDO0FBQUEsTUFDSDtBQUFBLElBQ0Y7QUFBQSxJQUNBLFNBQVMsQ0FBQyxNQUFNLEdBQUcsU0FBUyxpQkFBaUIsZ0JBQWdCLENBQUMsRUFBRSxPQUFPLE9BQU87QUFBQSxJQUM5RSxTQUFTO0FBQUEsTUFDUCxPQUFPO0FBQUEsUUFDTCxLQUFLLEtBQUssUUFBUSxrQ0FBVyxPQUFPO0FBQUEsTUFDdEM7QUFBQSxNQUNBLFFBQVEsQ0FBQyxTQUFTLGFBQWEscUJBQXFCLHlCQUF5Qix5QkFBeUIsc0JBQXNCO0FBQUEsSUFDOUg7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFsicGF0aCJdCn0K
