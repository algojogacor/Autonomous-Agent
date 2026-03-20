// core/uncertainty.js — Uncertainty Scoring & Human-in-the-Loop
// Implements confidence thresholds for destructive or risky operations.
// Industrial-grade agents know when to ask for help.
import { callOllama }   from "../agents/base.js";
import { MODELS, AGENT } from "../config.js";
import { logCorrection } from "../memory/preferences.js";

// ── Destructive pattern detection ────────────────────
const DESTRUCTIVE_PATTERNS = [
  /rm\s+-rf/i,
  /git\s+(push\s+--force|reset\s+--hard|clean\s+-fd)/i,
  /drop\s+(database|table|collection)/i,
  /delete\s+from.*where/i,
  /format\s+[a-z]:/i,             // format drive
  /mkfs/i,
  /dd\s+if=/i,
  /truncate/i,
  /forever\s+stopall/i,
  /pkill\s+-9/i,
  /taskkill.*\/f/i,
  /reg\s+delete/i,
  /netsh.*reset/i,
];

const SENSITIVE_PATTERNS = [
  /password|passwd|secret|api.?key|token|credential/i,
  /\.env/i,
  /ssh\s+.*@/i,
  /curl.*-d.*password/i,
  /send.*email|smtp/i,
  /payment|billing|charge/i,
];

/**
 * Classify risk level of a planned action.
 * @returns {{ level: 'safe'|'sensitive'|'destructive', reason: string }}
 */
export function classifyRisk(actionDescription) {
  for (const p of DESTRUCTIVE_PATTERNS) {
    if (p.test(actionDescription)) {
      return { level: "destructive", reason: `Matches destructive pattern: ${p}` };
    }
  }
  for (const p of SENSITIVE_PATTERNS) {
    if (p.test(actionDescription)) {
      return { level: "sensitive", reason: `Involves sensitive data: ${p}` };
    }
  }
  return { level: "safe", reason: "" };
}

/**
 * Ask the model to score its own confidence (0.0–1.0) on a task.
 * If below AGENT.uncertaintyThreshold, pause for human validation.
 */
export async function scoreConfidence(task, planSoFar = "") {
  const prompt = `Rate your confidence in completing this task successfully.
  
TASK: ${task}
${planSoFar ? `CURRENT PLAN:\n${planSoFar}` : ""}

Consider: complexity, ambiguity, risk of irreversible mistakes, missing information.

Respond ONLY in JSON:
{ "confidence": 0.0-1.0, "reason": "one sentence", "blockers": ["blocker1"] }`;

  try {
    const resp = await callOllama(MODELS.fast, [
      { role: "system", content: "You are a precise confidence estimator. JSON only." },
      { role: "user",   content: prompt },
    ]);
    const text = resp.choices?.[0]?.message?.content || "{}";
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    return {
      confidence: Math.min(1, Math.max(0, json.confidence ?? 0.8)),
      reason:     json.reason || "",
      blockers:   json.blockers || [],
    };
  } catch {
    return { confidence: 0.8, reason: "Could not assess", blockers: [] };
  }
}

/**
 * Gate: Check confidence + risk before proceeding.
 * If risky or low confidence → ask user.
 * Returns { proceed: bool, userResponse?: string }
 */
export async function confidenceGate({ action, task, rl, log, C }) {
  if (!AGENT.destructiveConfirm) return { proceed: true };

  const risk = classifyRisk(action);

  // Always ask for destructive actions
  if (risk.level === "destructive") {
    log(`\n⚠️  DESTRUCTIVE ACTION DETECTED`, C.red);
    log(`   Action: ${action.slice(0, 100)}`, C.yellow);
    log(`   Reason: ${risk.reason}`, C.yellow);

    const answer = await new Promise(r =>
      rl.question(`${C.red}${C.bold}Confirm this action? (yes/no): ${C.reset}`, r)
    );
    if (!answer.toLowerCase().startsWith("y")) {
      return { proceed: false, reason: "User rejected destructive action" };
    }
    return { proceed: true };
  }

  // Score confidence for complex tasks
  const { confidence, reason, blockers } = await scoreConfidence(task, action);

  if (confidence < AGENT.uncertaintyThreshold) {
    log(`\n❓ Low confidence: ${(confidence * 100).toFixed(0)}% — ${reason}`, C.yellow);
    if (blockers.length) {
      log(`   Blockers: ${blockers.join(", ")}`, C.gray);
    }

    const answer = await new Promise(r =>
      rl.question(
        `${C.cyan}Agent is ${(confidence * 100).toFixed(0)}% confident. Proceed anyway? (yes/no/details): ${C.reset}`,
        r
      )
    );

    if (answer.toLowerCase().startsWith("d")) {
      return { proceed: false, reason: "User requested more details", needsInfo: true };
    }
    if (!answer.toLowerCase().startsWith("y")) {
      return { proceed: false, reason: "User paused low-confidence action" };
    }
  }

  return { proceed: true, confidence, risk };
}

/**
 * Log a user correction to the preference system.
 */
export function recordCorrection(category, original, correction) {
  logCorrection(category, original, correction);
}
