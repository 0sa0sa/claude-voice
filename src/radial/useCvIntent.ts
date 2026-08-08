import { useCallback, useEffect, useRef } from "react";

/**
 * public/cv-intent.js が window.CVIntent として公開する判定ロジックの型。
 * calibrate.html で調整されたルールを atrium/vision/starkos と共有するため、
 * TSへ移植し直さずグローバルスクリプトをそのまま利用する。
 */
export interface CvIntentConfig {
  autoSendMs: number;
  urgent: string[];
  send: string[];
  collapse: string[];
  taskSeq: string[];
  enableProjectFocus?: boolean;
  scenes?: unknown[];
}

export interface CvIntentView {
  action: "task" | "project" | "collapse" | "none";
  seq?: number;
  project?: string;
}

export interface CvIntentResult {
  raw: string;
  send: { triggered: boolean; body: string };
  urgency: "urgent" | "normal";
  view: CvIntentView;
  chatText: string;
}

interface CvIntentGlobal {
  STORAGE_KEY: string;
  loadConfig(): CvIntentConfig;
  classify(text: string, cfg: CvIntentConfig, projectNames?: string[]): CvIntentResult;
}

declare global {
  interface Window {
    CVIntent?: CvIntentGlobal;
  }
}

const FALLBACK_CFG: CvIntentConfig = { autoSendMs: 2000, urgent: [], send: [], collapse: [], taskSeq: [] };

/** cv-intent.js のロードと、calibrate.html での更新(storageイベント)を追従する。 */
export function useCvIntent() {
  const cfgRef = useRef<CvIntentConfig>(window.CVIntent ? window.CVIntent.loadConfig() : FALLBACK_CFG);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (window.CVIntent && e.key === window.CVIntent.STORAGE_KEY) cfgRef.current = window.CVIntent.loadConfig();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const classify = useCallback((text: string, projectNames: string[]): CvIntentResult => {
    if (!window.CVIntent) {
      return { raw: text, send: { triggered: false, body: "" }, urgency: "normal", view: { action: "none" }, chatText: text };
    }
    return window.CVIntent.classify(text, cfgRef.current, projectNames);
  }, []);

  return { classify, autoSendMs: () => cfgRef.current.autoSendMs || 2000 };
}
