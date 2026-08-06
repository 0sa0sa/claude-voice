/*
 * cv-intent.js — 発言(発話/入力)から「動作」を判定する共有ロジック。
 * calibrate.html で調整し、atrium.html が同じ関数で実行する（設定は localStorage 共有）。
 *
 * classify(text, cfg, projectNames) → {
 *   raw, send:{triggered, body}, urgency:'urgent'|'normal',
 *   view:{action:'task'|'project'|'collapse'|'none', seq?, project?}, chatText
 * }
 * 判定順: 末尾「送信」コマンドで本文を取り出す → その本文に対して 緊急 / 俯瞰 / タスク番号 / プロジェクト名 を判定。
 */
(function (global) {
  const DEFAULTS = {
    autoSendMs: 2000,
    urgent: ["緊急", "大至急", "至急", "今すぐ", "いますぐ", "すぐに", "急いで", "最優先", "優先(で|して|的)", "\\basap\\b", "\\burgent\\b"],
    // capture group 1 = 送信する本文
    send: ["^(.*?)(?:、|。|\\s)?(?:送信|そうしん)\\s*$"],
    collapse: ["全体", "一覧", "俯瞰", "ぜんぶ", "全部", "戻して", "閉じて", "閉じる"],
    // capture group 1 = タスク連番
    taskSeq: [
      "タスク\\s*(?:番号)?\\s*#?(\\d{1,3})",
      "#(\\d{1,3})(?![0-9])",
      "(\\d{1,3})\\s*(?:番目|番|個目|つ目)\\s*の?\\s*タスク",
      "(\\d{1,3})\\s*の\\s*タスク",
      "(\\d{1,3})\\s*(?:番目|番)(?![0-9])",
    ],
    enableProjectFocus: true,
  };
  const STORAGE_KEY = "cv-calibration";
  const GROUPS = ["urgent", "send", "collapse", "taskSeq"];

  function compile(list) {
    const regexes = [], errors = [];
    (list || []).forEach((src, i) => {
      const s = String(src).trim();
      if (!s) return;
      try { regexes.push(new RegExp(s, "i")); } catch (e) { errors.push({ i, src: s, msg: e.message }); }
    });
    return { regexes, errors };
  }

  function normalize(cfg) {
    const c = Object.assign({}, DEFAULTS, cfg || {});
    GROUPS.forEach((k) => { if (!Array.isArray(c[k])) c[k] = DEFAULTS[k].slice(); });
    c.autoSendMs = Number(c.autoSendMs);
    if (!isFinite(c.autoSendMs) || c.autoSendMs < 200) c.autoSendMs = DEFAULTS.autoSendMs;
    c.enableProjectFocus = c.enableProjectFocus !== false;
    return c;
  }

  function loadConfig() {
    try { return normalize(JSON.parse(global.localStorage.getItem(STORAGE_KEY) || "null")); }
    catch (e) { return normalize(); }
  }
  function saveConfig(cfg) { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalize(cfg))); }
  function resetConfig() { try { global.localStorage.removeItem(STORAGE_KEY); } catch (e) {} }

  /** すべてのグループの正規表現エラーを集める（UIの検証表示用） */
  function validate(cfg) {
    cfg = normalize(cfg);
    const errors = {};
    GROUPS.forEach((k) => { const e = compile(cfg[k]).errors; if (e.length) errors[k] = e; });
    return errors;
  }

  function detectSeq(text, taskSeqRegexes) {
    for (const re of taskSeqRegexes) {
      const m = re.exec(text);
      if (m) {
        const num = m[1] != null ? m[1] : (m[0].match(/\d{1,3}/) || [])[0];
        if (num != null) return Number(num);
      }
    }
    return null;
  }

  function classify(text, cfg, projectNames) {
    cfg = normalize(cfg);
    projectNames = projectNames || [];
    const urgent = compile(cfg.urgent).regexes;
    const send = compile(cfg.send).regexes;
    const collapse = compile(cfg.collapse).regexes;
    const taskSeq = compile(cfg.taskSeq).regexes;
    const raw = String(text || "");

    let sendRes = { triggered: false, body: "" };
    for (const re of send) {
      const m = re.exec(raw.trim());
      if (m && (m[1] || "").trim()) { sendRes = { triggered: true, body: m[1].trim() }; break; }
    }
    const eff = sendRes.triggered ? sendRes.body : raw;

    const urgency = urgent.some((re) => re.test(eff)) ? "urgent" : "normal";

    let view = { action: "none" };
    if (collapse.some((re) => re.test(eff))) view = { action: "collapse" };
    else {
      const seq = detectSeq(eff, taskSeq);
      if (seq != null) view = { action: "task", seq };
      else if (cfg.enableProjectFocus) {
        const p = projectNames.find((n) => n && n.length >= 3 && eff.includes(n));
        if (p) view = { action: "project", project: p };
      }
    }
    return { raw, send: sendRes, urgency, view, chatText: eff };
  }

  const api = { DEFAULTS, STORAGE_KEY, GROUPS, normalize, compile, validate, loadConfig, saveConfig, resetConfig, classify };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.CVIntent = api;
})(typeof window !== "undefined" ? window : globalThis);
