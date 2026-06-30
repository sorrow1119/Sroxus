import { useEffect } from "react";
import ChatPage from "./pages/ChatPage";
import { I18nProvider } from "./i18n";

export default function App() {
  useEffect(() => {
    window.electronAPI.settings.get("theme").then((theme) => applyTheme(theme || "dark")).catch(() => applyTheme("dark"));
    const listener = () => {
      const theme = document.documentElement.dataset.theme || "dark";
      applyTheme(theme);
    };
    window.matchMedia?.("(prefers-color-scheme: light)").addEventListener("change", listener);
    return () => window.matchMedia?.("(prefers-color-scheme: light)").removeEventListener("change", listener);
  }, []);

  return (
    <I18nProvider>
      <ChatPage />
    </I18nProvider>
  );
}

function applyTheme(theme: string) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches;
  root.dataset.effectiveTheme = theme === "system" ? (prefersLight ? "light" : "dark") : theme;
}
