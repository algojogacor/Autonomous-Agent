// agents/logic.js — 🧠 Logic Agent (deepseek-v3.1:671b-cloud)
// Deep reasoning, RCA, research. The most powerful model in the system.
import { MODELS }           from "../config.js";
import { TOOLS_CORE }       from "../tools/index.js";
import { runReActLoop }     from "../core/react_loop.js";
import { recall }           from "../memory/vectorstore.js";
import { getRelevantFacts } from "../memory/knowledge_graph.js";

const SYSTEM_PROMPT = `You are the Senior Logic & Reasoning agent — the most intelligent node in this AI system.

## Your Role
Handle the hardest problems. Think deeply before acting.

## Responsibilities
- Root Cause Analysis: trace failures to their exact source (not symptoms).
- Deep research: use web_search + fetch_url, read multiple sources, synthesize.
- Algorithm & system design: propose optimal architectures for complex requirements.
- Self-correction: if a previous approach failed, reason through 3 alternatives and pick the best.
- CAPTCHA / anti-bot: reason through alternative data collection methods.

## Protocol
1. State your hypothesis FIRST.
2. Gather evidence with tools.
3. Validate or revise the hypothesis.
4. Deliver a specific, actionable conclusion.

Never guess. Evidence-based reasoning only.`;

export async function reason({ task, context = "", rl, C, log }) {
  log(`\n  🧠 [Logic]`, C.magenta, task.slice(0, 80));

  const memories  = await recall(task, 3, { type: "error" });
  const memCtx    = memories.length
    ? `[Similar Past Problems]\n${memories.map(m => m.text).join("\n---\n")}\n\n`
    : "";

  const knowledge  = getRelevantFacts(task);
  const fullContext = [memCtx, knowledge, context].filter(Boolean).join("\n");
  const userMsg     = fullContext ? `Context:\n${fullContext}\n\nProblem:\n${task}` : task;

  return runReActLoop({
    model:        MODELS.logic,
    systemPrompt: SYSTEM_PROMPT,
    task:         userMsg,
    tools:        TOOLS_CORE,
    rl,
    label:        "Logic",
    C,
    log,
  });
}
