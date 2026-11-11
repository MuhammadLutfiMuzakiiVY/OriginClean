import React from "react";
import { ShieldCheck, ExternalLink, Scale, Code2, Award } from "lucide-react";
import type { AboutPayload } from "../types/originclean";

interface AboutPageProps {
  about: AboutPayload | null;
}

export const AboutPage: React.FC<AboutPageProps> = ({ about }) => {
  const app = about?.app || {
    name: "OriginClean",
    product_name: "OriginClean",
    tagline: "Clean Your Files. Preserve Their Origin.",
    version: "1.0.0",
    identifier: "com.muhammadlutfimuzaki.originclean",
    developer: "Muhammad Lutfi Muzaki",
    creator: "Muhammad Lutfi Muzaki",
    publisher: "Muhammad Lutfi Muzaki",
    author: "Muhammad Lutfi Muzaki",
    copyright: "Copyright © 2026 Muhammad Lutfi Muzaki. All rights reserved.",
    github_owner: "MuhammadLutfiMuzakiiVY",
    repository_name: "OriginClean",
    repository_url: "https://github.com/MuhammadLutfiMuzakiiVY/OriginClean",
    license: "MIT",
    upstream_attribution:
      "Core inspection and cleaning algorithms adapted from watermarks-remover (MIT License, Copyright (c) 2026 Guillaume Meyer and contributors).",
  };

  const notices = about?.third_party_notices || [
    {
      name: "watermarks-remover",
      author: "Guillaume Meyer and contributors",
      license: "MIT",
      url: "https://github.com/guillaumemeyer/watermarks-remover",
      role: "Core multi-format inspection and metadata/Unicode cleaning algorithms",
    },
    {
      name: "Tauri 2",
      author: "The Tauri Programme within The Commons Conservancy",
      license: "MIT / Apache-2.0",
      url: "https://tauri.app",
      role: "Cross-platform Rust desktop application framework",
    },
    {
      name: "React & Lucide Icons",
      author: "Meta Open Source & Lucide Contributors",
      license: "MIT / ISC",
      url: "https://react.dev",
      role: "Graphical user interface components and icons",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Hero Brand Card */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
              <ShieldCheck className="h-8 w-8" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-bold tracking-tight">{app.name}</h1>
                <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  v{app.version}
                </span>
              </div>
              <p className="mt-0.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                {app.tagline}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Developed and maintained by <strong>{app.developer}</strong>
              </p>
            </div>
          </div>

          <a
            href={app.repository_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 px-3.5 py-2 text-xs font-semibold text-white dark:text-slate-900 hover:opacity-90"
          >
            <span>GitHub Repository</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 border-t border-slate-100 dark:border-slate-800 pt-5 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <div>
            <span className="text-slate-400 block text-[11px]">Developer & Creator</span>
            <span className="font-semibold">{app.developer}</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[11px]">Publisher</span>
            <span className="font-semibold">{app.publisher}</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[11px]">Application Identifier</span>
            <span className="font-mono text-[11px]">{app.identifier}</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[11px]">License</span>
            <span className="font-semibold">{app.license} License</span>
          </div>
        </div>

        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">{app.copyright}</p>
      </div>

      {/* License & Third-Party Acknowledgments */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Award className="h-4 w-4 text-emerald-500" />
            <span>Third-Party Acknowledgments & Open-Source Dependencies</span>
          </h2>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
            {app.upstream_attribution}
          </p>
          <div className="space-y-2.5 pt-2">
            {notices.map((n) => (
              <div
                key={n.name}
                className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{n.name}</span>
                  <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-mono text-[10px]">
                    {n.license}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">Author: {n.author}</p>
                <p className="text-[11px] text-slate-600 dark:text-slate-300">{n.role}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Scale className="h-4 w-4 text-sky-500" />
            <span>MIT License & Attribution Notice</span>
          </h2>
          <pre className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-slate-600 dark:text-slate-300">
{`MIT License

Copyright © 2026 Muhammad Lutfi Muzaki. All rights reserved.
Core processing engine adapted from watermarks-remover:
Copyright (c) 2026 Guillaume Meyer and contributors.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.`}
          </pre>
          <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-500">
            <Code2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <span>Repository: {app.repository_url}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

