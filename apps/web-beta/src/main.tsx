import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./app/auth";
import { ThemeProvider } from "./app/theme";
import { i18n, initI18n } from "./i18n";
import { registerServiceWorker } from "./lib/pwa";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

void initI18n().then(() => {
  createRoot(root).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </ThemeProvider>
      </I18nextProvider>
    </StrictMode>,
  );
});

registerServiceWorker();
