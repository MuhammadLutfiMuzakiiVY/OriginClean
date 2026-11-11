import React, { useState, useEffect, useCallback } from "react";
import { SidebarLayout } from "./layouts/SidebarLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { FileCleanerPage } from "./pages/FileCleanerPage";
import { FileInspectorPage } from "./pages/FileInspectorPage";
import { WatermarkToolsPage } from "./pages/WatermarkToolsPage";
import { MetadataManagerPage } from "./pages/MetadataManagerPage";
import { BatchProcessingPage } from "./pages/BatchProcessingPage";
import { HistoryPage } from "./pages/HistoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AboutPage } from "./pages/AboutPage";
import { ToastContainer, type ToastMessage } from "./components/Toast";
import { api } from "./services/api";
import type {
  AboutPayload,
  AppSettings,
  DashboardPayload,
  NavigationTab,
} from "./types/originclean";

const DEFAULT_SETTINGS_STATE: AppSettings = {
  theme: "system",
  language: "en",
  default_output_dir: "",
  open_output_after_clean: false,
  preserve_c2pa_by_default: true,
  keep_non_ai_metadata: false,
  also_layer_a_text: true,
  normalize_spaces: true,
  nfkc_normalization: false,
  aggressive_homoglyphs: false,
  deep_images: "auto",
  clean_attachments: "always",
  batch_concurrency: 4,
  max_file_size_mb: 256,
  automatic_backup: true,
  secure_temp_cleanup: true,
  local_only_mode: true,
  allow_external_network: false,
  telemetry_enabled: false,
};

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavigationTab>("dashboard");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [about, setAbout] = useState<AboutPayload | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS_STATE);
  const [backendOnline, setBackendOnline] = useState<boolean>(false);
  const [loadingDash, setLoadingDash] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const notify = useCallback(
    (type: "success" | "error" | "info", title: string, message?: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, type, title, message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshTelemetry = useCallback(async () => {
    setLoadingDash(true);
    try {
      const [dashRes, settingsRes, aboutRes] = await Promise.all([
        api.getDashboard(),
        api.getSettings(),
        api.getAbout(),
      ]);
      setDashboard(dashRes);
      setSettings(settingsRes.settings);
      setAbout(aboutRes);
      setBackendOnline(true);
    } catch {
      setBackendOnline(false);
    } finally {
      setLoadingDash(false);
    }
  }, []);

  useEffect(() => {
    refreshTelemetry();
  }, [refreshTelemetry]);

  useEffect(() => {
    const root = document.documentElement;
    const prefersDark =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = settings.theme === "dark" || (settings.theme === "system" && prefersDark);
    root.classList.toggle("dark", isDark);
  }, [settings.theme]);

  const handleChangeTheme = async (theme: "light" | "dark" | "system") => {
    setSettings((prev) => ({ ...prev, theme }));
    try {
      const res = await api.updateSettings({ theme });
      setSettings(res.settings);
    } catch {
      // Keep local theme state even if offline
    }
  };

  const handleSaveSettings = async (patch: Partial<AppSettings>) => {
    try {
      const res = await api.updateSettings(patch);
      setSettings(res.settings);
      notify("success", "Preferences saved");
    } catch (err) {
      notify("error", "Failed to save settings", err instanceof Error ? err.message : String(err));
    }
  };

  const handleResetSettings = async () => {
    try {
      const res = await api.resetSettings();
      setSettings(res.settings);
      notify("info", "Settings restored to defaults");
    } catch (err) {
      notify("error", "Failed to reset settings", err instanceof Error ? err.message : String(err));
    }
  };

  const appVersion = dashboard?.app?.version || about?.app?.version || "1.0.0";

  return (
    <>
      <SidebarLayout
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        backendOnline={backendOnline}
        version={appVersion}
        theme={settings.theme}
        onChangeTheme={handleChangeTheme}
      >
        {activeTab === "dashboard" && (
          <DashboardPage
            data={dashboard}
            loading={loadingDash}
            onRefresh={refreshTelemetry}
            onNavigate={setActiveTab}
          />
        )}
        {activeTab === "cleaner" && (
          <FileCleanerPage
            defaultOutputDir={settings.default_output_dir}
            defaultPreserveC2pa={settings.preserve_c2pa_by_default}
            onCompleteOperation={refreshTelemetry}
            onNotify={notify}
          />
        )}
        {activeTab === "inspector" && (
          <FileInspectorPage onCompleteOperation={refreshTelemetry} onNotify={notify} />
        )}
        {activeTab === "watermark" && (
          <WatermarkToolsPage
            capabilities={dashboard?.capabilities || null}
            onCompleteOperation={refreshTelemetry}
            onNotify={notify}
          />
        )}
        {activeTab === "metadata" && (
          <MetadataManagerPage onCompleteOperation={refreshTelemetry} onNotify={notify} />
        )}
        {activeTab === "batch" && (
          <BatchProcessingPage
            defaultConcurrency={settings.batch_concurrency}
            defaultOutputDir={settings.default_output_dir}
            onCompleteOperation={refreshTelemetry}
            onNotify={notify}
          />
        )}
        {activeTab === "history" && (
          <HistoryPage onHistoryChanged={refreshTelemetry} onNotify={notify} />
        )}
        {activeTab === "settings" && (
          <SettingsPage
            settings={settings}
            appVersion={appVersion}
            capabilities={dashboard?.capabilities || null}
            onSaveSettings={handleSaveSettings}
            onResetSettings={handleResetSettings}
            onCheckStatus={refreshTelemetry}
          />
        )}
        {activeTab === "about" && <AboutPage about={about} />}
      </SidebarLayout>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
};

export default App;

