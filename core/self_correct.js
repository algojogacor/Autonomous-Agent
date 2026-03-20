// core/self_correct.js — Self-Correction Engine
// Implements:
//   1. Internal Monologue: DeepSeek audits Manager's plan before execution
//   2. Root Cause Analysis: Deep stack trace analysis on failures
//   3. Pre-emptive Mitigation: Identifies failure points before acting
import { callOllama } from "../agents/base.js";
import { MODELS }     from "../config.js";
import { recall }     from "../memory/vectorstore.js";

// ── 1. Plan Auditor (Internal Monologue) ─────────────
/**
 * Before the Manager executes a plan, the Logic agent audits it.
 * Returns { approved: bool, concerns: string[], improvedPlan: string }
 */
export async function auditPlan({ plan, context = "" }) {
  const prompt = `You are a critical auditor reviewing an AI agent's execution plan.
  
PLAN TO AUDIT:
${plan}

CONTEXT:
${context}

Your job: Critique this plan. Check for:
1. Missing steps or assumptions
2. Potential failures or edge cases
3. Irreversible actions that need user confirmation
4. Better approaches

Respond in this JSON format:
{
  "approved": true|false,
  "concerns": ["concern 1", "concern 2"],
  "failPoints": ["potential failure 1", "potential failure 2", "potential failure 3"],
  "mitigations": ["mitigation 1", "mitigation 2", "mitigation 3"],
  "improvedPlan": "rewritten plan addressing the concerns (or same plan if good)"
}`;

  try {
    const resp = await callOllama(MODELS.logic, [
      { role: "system", content: "You are a precise plan auditor. Respond only in valid JSON." },
      { role: "user",   content: prompt },
    ]);
    const text = resp.choices?.[0]?.message?.content || "{}";
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    return {
      approved:      json.approved ?? true,
      concerns:      json.concerns || [],
      failPoints:    json.failPoints || [],
      mitigations:   json.mitigations || [],
      improvedPlan:  json.improvedPlan || plan,
    };
  } catch {
    return { approved: true, concerns: [], failPoints: [], mitigations: [], improvedPlan: plan };
  }
}

// ── 2. Root Cause Analysis ────────────────────────────
/**
 * Analyze a failure deeply. Returns a specific patch/fix plan.
 * @param {object} params
 * @param {string} params.tool - which tool failed
 * @param {string} params.command - what was attempted
 * @param {string} params.error - the full error/stderr
 * @param {string} params.code - relevant code (if any)
 * @returns {{ rootCause, fix, patchInstructions, confidence }}
 */
export async function rootCauseAnalysis({ tool, command, error, code = "" }) {
  // Check memory for similar past errors
  const similar = await recall(`${tool} error: ${error.slice(0, 100)}`, 3, { type: "error" });
  const pastSolutions = similar
    .filter(m => m.score > 0.7)
    .map(m => m.text)
    .join("\n");

  const prompt = `You are a senior software engineer performing Root Cause Analysis.

FAILED TOOL: ${tool}
COMMAND/OPERATION: ${command}
ERROR OUTPUT:
${error}
${code ? `\nRELEVANT CODE:\n${code}` : ""}
${pastSolutions ? `\nSIMILAR PAST ERRORS AND SOLUTIONS:\n${pastSolutions}` : ""}

Perform a precise RCA. Do NOT give generic advice. Be specific to this exact error.

Respond in JSON:
{
  "rootCause": "exact technical reason for the failure",
  "fix": "precise single-sentence fix",
  "patchInstructions": ["step 1", "step 2", "step 3"],
  "confidence": 0.0-1.0,
  "preventionNote": "how to avoid this in the future"
}`;

  try {
    const resp = await callOllama(MODELS.logic, [
      { role: "system", content: "You are a precise RCA engineer. Respond only in valid JSON." },
      { role: "user",   content: prompt },
    ]);
    const text = resp.choices?.[0]?.message?.content || "{}";
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    return {
      rootCause:         json.rootCause || "Unknown",
      fix:               json.fix || "Manual investigation required",
      patchInstructions: json.patchInstructions || [],
      confidence:        json.confidence || 0.5,
      preventionNote:    json.preventionNote || "",
    };
  } catch {
    return { rootCause: "Parse error", fix: error.slice(0, 200), patchInstructions: [], confidence: 0.3 };
  }
}

// ── 3. Retry with Self-Correction ────────────────────
/**
 * Execute a function with auto-retry using RCA on failure.
 * @param {Function} fn - async function to execute
 * @param {Function} getContext - () => { tool, command, code } for RCA
 * @param {number} maxRetries
 * @param {object} logger - { log, C }
 * @returns result of fn, or throws after maxRetries
 */
export async function withSelfCorrection(fn, getContext, maxRetries, { log, C }) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      // Check for bash errors
      if (result?.exit_code > 0 || result?.error) {
        throw new Error(result.stderr || result.error || "Non-zero exit");
      }
      return result;
    } catch (err) {
      lastError = err;
      log(`  ⚠ Attempt ${attempt}/${maxRetries} failed:`, C.yellow, err.message.slice(0, 100));

      if (attempt < maxRetries) {
        const ctx = getContext ? getContext() : {};
        log(`  🔍 Running RCA...`, C.magenta);
        const rca = await rootCauseAnalysis({
          tool:    ctx.tool || "unknown",
          command: ctx.command || "",
          error:   err.message,
          code:    ctx.code || "",
        });
        log(`  💡 Root cause:`, C.cyan, rca.rootCause);
        log(`  🔧 Fix:`, C.green, rca.fix);
        // The caller should apply the fix based on patchInstructions
        err.rca = rca;
      }
    }
  }
  throw lastError;
}
