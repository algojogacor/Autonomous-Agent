// tools/index.js — Master Tool Registry
// Add new tools here. All agents pull from this registry.
import * as bash    from "./bash.js";
import * as files   from "./files.js";
import * as web     from "./web.js";
import * as api     from "./api.js";
import * as gui     from "./gui.js";
import * as mem     from "./memory_tools.js";

// ── Executor Map: tool name → async function ─────────
export const EXECUTORS = {
  // Bash
  execute_bash:          (a) => bash.execute(a),
  execute_bash_parallel: (a) => bash.executeParallel(a),

  // Files
  read_file:             (a) => files.readFile(a),
  write_file:            (a) => files.writeFile(a),
  patch_file:            (a) => files.patchFile(a),
  list_directory:        (a) => files.listDirectory(a),

  // Web
  web_search:            (a) => web.webSearch(a),
  fetch_url:             (a) => web.fetchUrl(a),

  // API
  call_api:              (a) => api.execute(a),

  // GUI
  take_screenshot:       (a) => gui.takeScreenshot(a),
  mouse_click:           (a) => gui.mouseClick(a),
  mouse_move:            (a) => gui.mouseMove(a),
  mouse_scroll:          (a) => gui.mouseScroll(a),
  keyboard_type:         (a) => gui.keyboardType(a),

  // Memory
  save_progress:         (a) => mem.saveProgress(a),
  recall_memory:         (a) => mem.recallMemory(a),
  learn_fact:            (a) => mem.learnFact(a),
  query_knowledge:       (a) => mem.queryKnowledge(a),
};

// ── Tool Sets by Agent Role ───────────────────────────

export const TOOLS_CORE = [
  bash.definition,
  bash.parallelDef,
  files.readDef,
  files.writeDef,
  files.patchDef,
  files.listDef,
  web.searchDef,
  web.fetchDef,
  api.definition,
  mem.saveDef,
  mem.recallDef,
  mem.learnDef,
  mem.queryKgDef,
];

export const TOOLS_GUI = [
  ...TOOLS_CORE,
  gui.screenshotDef,
  gui.mouseClickDef,
  gui.mouseMoveDef,
  gui.scrollDef,
  gui.keyboardDef,
];

export const TOOLS_ALL = TOOLS_GUI;
