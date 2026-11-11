import React from "react";
import {
  LayoutDashboard,
  Sparkles,
  SearchCode,
  Stamp,
  Database,
  Layers,
  History,
  Settings,
  Info,
  ShieldCheck,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import type { NavigationTab } from "../types/originclean";

interface SidebarLayoutProps {
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  backendOnline: boolean;
  version: string;
  theme: "light" | "dark" | "system";
  onChangeTheme: (theme: "light" | "dark" | "system") => void;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  id: NavigationTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  section: "main" | "system";
}> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, section: "main" },
  { id: "cleaner", label: "File Cleaner", icon: Sparkles, section: "main" },
  { id: "inspector", label: "File Inspector", icon: SearchCode, section: "main" },
  { id: "watermark", label: "Watermark Tools", icon: Stamp, section: "main" },
  { id: "metadata", label: "Metadata Manager", icon: Database, section: "main" },
  { id: "batch", label: "Batch Processing", icon: Layers, section: "main" },
  { id: "history", label: "Processing History", icon: History, section: "main" },
  { id: "settings", label: "Settings", icon: Settings, section: "system" },
  { id: "about", label: "About OriginClean", icon: Info, section: "system" },
];

export const SidebarLayout: React.FC<SidebarLayoutProps> = ({
  activeTab,
  onSelectTab,
  backendOnline,
  version,
  theme,
  onChangeTheme,
  children,
}) => {
  const mainItems = NAV_ITEMS.filter((i) => i.section === "main");
  const systemItems = NAV_ITEMS.filter((i) => i.section === "system");

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xs">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-tight">OriginClean</span>
              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                v{version}
              </span>
            </div>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              Clean Your Files. Preserve Their Origin.
            </p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Main Navigation">
          <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Workspace
          </div>
          {mainItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  active
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}

          <div className="pt-5 px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Application
          </div>
          {systemItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  active
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 dark:border-slate-800 p-3 space-y-2.5">
          <div className="flex items-center justify-between rounded-lg bg-slate-100 dark:bg-slate-800/70 p-1">
            <button
              type="button"
              onClick={() => onChangeTheme("light")}
              className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-[11px] font-medium ${
                theme === "light"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
              title="Light Mode"
            >
              <Sun className="h-3.5 w-3.5" />
              <span>Light</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeTheme("dark")}
              className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-[11px] font-medium ${
                theme === "dark"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
              title="Dark Mode"
            >
              <Moon className="h-3.5 w-3.5" />
              <span>Dark</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeTheme("system")}
              className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-[11px] font-medium ${
                theme === "system"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
              title="System Theme"
            >
              <Monitor className="h-3.5 w-3.5" />
              <span>Auto</span>
            </button>
          </div>

          <div className="flex items-center justify-between px-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  backendOnline ? "bg-emerald-500" : "bg-rose-500"
                }`}
              />
              {backendOnline ? "Engine Ready (Local)" : "Engine Offline"}
            </span>
            <span className="truncate font-medium">M. Lutfi Muzaki</span>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-6">{children}</div>
      </main>
    </div>
  );
};

