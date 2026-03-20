// core/debate.js — Adversarial Debate Engine
// For high-complexity coding tasks:
//   1. Both Coder (qwen3-coder) and Logic (deepseek) write solutions
//   2. Each reviews the other's code and votes
//   3. If divergent, they debate until consensus or max rounds
//   4. Manager picks the winner
import { callOllama }    from "../agents/base.js";
import { MODELS, AGENT } from "../config.js";
import { remember }      from "../memory/vectorstore.js";

/**
 * Run an adversarial debate for a coding task.
 *
 * @param {string} task - the coding problem
 * @param {string} context - relevant context (existing code, error, requirements)
 * @param {object} logger - { log, C }
 * @returns {{ winner: 'coder'|'logic'|'consensus', solution: string, reasoning: string }}
 */
export async function debate(task, context = "", { log, C }) {
  log(`\n  ⚔️  [Adversarial Debate]`, C.magenta, task.slice(0, 80));

  const taskPrompt = context ? `${task}\n\nContext:\n${context}` : task;

  // ── Round 0: Both write independently ────────────
  log(`  [Debate] Round 0 — Independent Solutions`, C.blue);

  const [coderResp, logicResp] = await Promise.all([
    callOllama(MODELS.coder, [
      { role: "system", content: "You are an expert programmer. Write clean, complete, working code." },
      { role: "user",   content: taskPrompt },
    ]),
    callOllama(MODELS.logic, [
      { role: "system", content: "You are a senior software architect. Write optimal, well-structured code." },
      { role: "user",   content: taskPrompt },
    ]),
  ]);

  let coderSolution = coderResp.choices?.[0]?.message?.content || "";
  let logicSolution = logicResp.choices?.[0]?.message?.content || "";

  log(`  [Debate] Coder solution: ${coderSolution.length} chars`, C.gray);
  log(`  [Debate] Logic solution: ${logicSolution.length} chars`, C.gray);

  // ── Debate Rounds ─────────────────────────────────
  for (let round = 1; round <= AGENT.maxDebateRounds; round++) {
    log(`  [Debate] Round ${round} — Cross Review`, C.blue);

    const [coderReview, logicReview] = await Promise.all([
      // Coder reviews Logic's solution
      callOllama(MODELS.coder, [
        { role: "system", content: `You are reviewing a peer's code solution. Be critical but fair.
Respond in JSON: { "verdict": "accept"|"reject"|"merge", "issues": ["issue1"], "improved": "improved code or empty if accept" }` },
        { role: "user", content: `Task: ${task}\n\nPeer's solution to review:\n${logicSolution}` },
      ]),
      // Logic reviews Coder's solution
      callOllama(MODELS.logic, [
        { role: "system", content: `You are reviewing a peer's code solution. Focus on correctness and architecture.
Respond in JSON: { "verdict": "accept"|"reject"|"merge", "issues": ["issue1"], "improved": "improved code or empty if accept" }` },
        { role: "user", content: `Task: ${task}\n\nPeer's solution to review:\n${coderSolution}` },
      ]),
    ]);

    let cr, lr;
    try { cr = JSON.parse(coderReview.choices?.[0]?.message?.content?.replace(/```json|```/g, "").trim() || "{}"); } catch { cr = { verdict: "accept" }; }
    try { lr = JSON.parse(logicReview.choices?.[0]?.message?.content?.replace(/```json|```/g, "").trim() || "{}"); } catch { lr = { verdict: "accept" }; }

    log(`  [Debate] Coder verdict on Logic: ${cr.verdict}`, C.yellow);
    log(`  [Debate] Logic verdict on Coder: ${lr.verdict}`, C.yellow);

    // Both accept each other → consensus
    if (cr.verdict === "accept" && lr.verdict === "accept") {
      log(`  [Debate] ✓ Consensus reached at round ${round}`, C.green);
      // Pick the shorter, cleaner solution
      const winner = coderSolution.length <= logicSolution.length ? "coder" : "logic";
      const solution = winner === "coder" ? coderSolution : logicSolution;
      await remember(`Solved: ${task.slice(0, 100)}`, { type: "code", solution: solution.slice(0, 300) });
      return { winner, solution, reasoning: "Consensus after peer review" };
    }

    // Apply improvements
    if (lr.improved) coderSolution = lr.improved;
    if (cr.improved) logicSolution = cr.improved;
  }

  // ── No consensus → Orchestrator picks ────────────
  log(`  [Debate] Max rounds — asking Orchestrator to choose`, C.yellow);

  const arbiterResp = await callOllama(MODELS.orchestrator, [
    { role: "system", content: `You are the final arbiter. Choose the better code solution for the user.
Respond in JSON: { "winner": "A"|"B", "reason": "...", "finalSolution": "the chosen or merged code" }` },
    { role: "user", content: `Task: ${task}

SOLUTION A (Coder):\n${coderSolution}

SOLUTION B (Logic):\n${logicSolution}

Which is better? You may merge the best parts.` },
  ]);

  let arb;
  try { arb = JSON.parse(arbiterResp.choices?.[0]?.message?.content?.replace(/```json|```/g, "").trim() || "{}"); }
  catch { arb = { winner: "A", finalSolution: coderSolution, reason: "Defaulting to coder" }; }

  const finalWinner = arb.winner === "A" ? "coder" : "logic";
  const finalSolution = arb.finalSolution || (finalWinner === "coder" ? coderSolution : logicSolution);

  await remember(`Solved (debate): ${task.slice(0, 100)}`, { type: "code", solution: finalSolution.slice(0, 300) });

  return {
    winner:    finalWinner,
    solution:  finalSolution,
    reasoning: arb.reason || "Arbiter decision",
  };
}
