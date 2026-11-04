import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { initBranding } from "./lib/branding";
import "./index.css";

// Le branding (nom, logo, couleurs) est résolu avant le premier rendu pour
// éviter tout flash de la marque par défaut.
initBranding().finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
