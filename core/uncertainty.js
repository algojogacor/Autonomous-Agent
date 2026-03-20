// core/uncertainty.js — Uncertainty Scoring & Human-in-the-Loop
// FIXED: Only gates on genuinely destructive actions.
// Safe operations (read, search, list) NEVER trigger a gate.
import { logCorrection } from "../memory/preferences.js";

// ── Truly destructive patterns ONLY ─────────────────
// These always require explicit user confirmation before running.
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\brd\s+\/s\s+\/q\b/i,               // Windows: rd /s /q
  /Remove-Item.*-Recurse.*-Force/i,     // PowerShell delete
  /git\s+(push\s+--force|reset\s+--hard)/i,
  /drop\s+(database|table|collection)\b/i,
  /\bformat\s+[a-z]:\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bsend.*email\b/i,
  /\bsmtp\b/i,
];

// ── Safe tool names — NEVER gate these ───────────────
const ALWAYS_SAFE_TOOLS = new Set([
  "list_directory",
  "read_file",
  "web_search",
  "fetch_url",
  "recall_memory",
  "query_knowledge",
  "save_progress",
  "learn_fact",
  "take_screenshot",
  "mouse_move",
  "audit_plan",
]);

/**
 * Classify risk level of an action string.
 */
export function classifyRisk(action) {
  for (const p of DESTRUCTIVE_PATTERNS) {
    if (p.test(action)) {
      return { level: "destructive", reason: `Destructive pattern detected: ${p.source}` };
    }
  }
  return { level: "safe", reason: "" };
}

/**
 * Confidence gate — ONLY blocks on genuinely destructive actions.
 * Safe tools and normal operations pass through instantly with no LLM call.
 */
export async function confidenceGate({ action, task, toolName, rl, log, C }) {
  // Always-safe tools: instant pass
  if (toolName && ALWAYS_SAFE_TOOLS.has(toolName)) {
    return { proceed: true };
  }

  // Write/patch files: safe, pass through
  if (toolName === "write_file" || toolName === "patch_file") {
    return { proceed: true };
  }

  // API calls: safe
  if (toolName === "call_api") {
    return { proceed: true };
  }

  // mouse_click and keyboard: pass through (Vision agent already verified coords)
  if (toolName === "mouse_click" || toolName === "keyboard_type" || toolName === "mouse_scroll") {
    return { proceed: true };
  }

  // For bash commands: only gate on truly destructive patterns
  if (toolName === "execute_bash" || toolName === "execute_bash_parallel") {
    const risk = classifyRisk(action);
    if (risk.level === "destructive") {
      log(`\n⚠️  DESTRUCTIVE COMMAND DETECTED`, C.red);
      log(`   ${action.slice(0, 120)}`, C.yellow);
      const answer = await new Promise(r =>
        rl.question(`${C.red}${C.bold}Confirm? (yes/no): ${C.reset}`, r)
      );
      if (!answer.toLowerCase().startsWith("y")) {
        return { proceed: false, reason: "User rejected destructive command" };
      }
    }
    return { proceed: true };
  }

  // Everything else: proceed
  return { proceed: true };
}

export function recordCorrection(category, original, correction) {
  logCorrection(category, original, correction);
}