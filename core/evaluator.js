// core/evaluator.js
// ═══════════════════════════════════════════════════════════════
// PATTERN: Evaluator-Optimizer Loop — dari Anthropic & LangGraph
// ═══════════════════════════════════════════════════════════════
//
// Anthropic "Building Effective Agents" (2025):
//   "One particularly effective pattern is the evaluator-optimizer loop:
//    one LLM generates a response, another evaluates it, and the generator
//    refines based on feedback — iterating until quality threshold is met."
//
// Implementasi:
//   Generator → Evaluator → Score < threshold? → Generator again → ...
//   Max 3 iterations. Stops early if score >= 0.85.

import { callOllama } from "../agents/base.js";
import { MODELS }     from "../config.js";

const EVALUATOR_PROMPT = `You are a strict output quality evaluator.

Evaluate the given output against the original task.

Score on these dimensions (0.0 - 1.0 each):
- completeness: Does it fully address the task?
- accuracy:     Is the information correct and specific?
- format:       Is it formatted as requested (file, table, list, etc.)?
- actionable:   Can the user directly use this output?

Respond ONLY in JSON:
{
  "score": 0.0-1.0,
  "completeness": 0.0-1.0,
  "accuracy": 0.0-1.0,
  "format": 0.0-1.0,
  "actionable": 0.0-1.0,
  "feedback": "specific improvement needed (1-2 sentences)",
  "approved": true|false
}`;

const OPTIMIZER_PROMPT = `You are improving a previous output based on evaluator feedback.

Keep what is good. Fix only what the feedback says.
Do NOT start over — refine and improve the existing output.`;

/**
 * Run evaluator-optimizer loop on any output.
 *
 * @param {string} task       - Original user task
 * @param {string} output     - First draft output
 * @param {object} opts       - { maxIterations: 3, threshold: 0.85, model, log, C }
 * @returns {string}          - Best output after iterations
 */
export async function evaluateAndOptimize(task, output, opts = {}) {
  const {
    maxIterations = 3,
    threshold     = 0.85,
    model         = MODELS.logic,
    log           = () => {},
    C             = {},
  } = opts;

  let current = output;

  for (let i = 0; i < maxIterations; i++) {
    // Evaluate
    const evalResp = await callOllama(model, [
      { role: "system", content: EVALUATOR_PROMPT },
      { role: "user",   content: `TASK:\n${task}\n\nOUTPUT TO EVALUATE:\n${current}` },
    ]);

    let eval_result;
    try {
      const text  = evalResp.message?.content || "{}";
      eval_result = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      break; // Can't parse evaluation, return current
    }

    const score = eval_result.score || 0;
    log(`  📊 Eval [iter ${i+1}]: score=${(score*100).toFixed(0)}% — ${eval_result.feedback || ""}`,
        C.gray || "");

    // Good enough → done
    if (score >= threshold || eval_result.approved) {
      log(`  ✓ Quality approved at ${(score*100).toFixed(0)}%`, C.green || "");
      break;
    }

    // Last iteration → return as-is
    if (i === maxIterations - 1) break;

    // Optimize
    const optResp = await callOllama(model, [
      { role: "system",    content: OPTIMIZER_PROMPT },
      { role: "user",      content: `ORIGINAL TASK:\n${task}` },
      { role: "assistant", content: current },
      { role: "user",      content: `EVALUATOR FEEDBACK:\n${eval_result.feedback}\n\nPlease improve the output.` },
    ]);

    const improved = optResp.message?.content || current;
    if (improved.trim()) current = improved;
  }

  return current;
}