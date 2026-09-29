import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { LanguageProvider } from "./i18n.js";
import "./styles.css";
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // The online app remains usable if offline support is unavailable.
    });
  });
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>,
);
