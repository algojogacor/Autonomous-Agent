// agents/coder.js — 💻 Coder Agent (qwen3-coder:480b-cloud)
// Writes, debugs, runs code. Uses adversarial debate for complex tasks.
import { MODELS }          from "../config.js";
import { TOOLS_CORE }      from "../tools/index.js";
import { runReActLoop }    from "../core/react_loop.js";
import { debate }          from "../core/debate.js";
import { recall }          from "../memory/vectorstore.js";
import { getContextString } from "../memory/preferences.js";
import { getRelevantFacts } from "../memory/knowledge_graph.js";

// Complexity heuristic — use debate for hard tasks
function isComplexTask(task) {
  const markers = [
    /build.*(?:full|complete|entire)/i,
    /(?:integrate|architect|design.*system)/i,
    /(?:websocket|realtime|concurrent)/i,
    /(?:scrape|automate.*browser|puppeteer)/i,
    /(?:optimize|performance.*bottleneck)/i,
    /(?:security|auth|jwt|oauth)/i,
  ];
  return markers.some(m => m.test(task));
}

const SYSTEM_PROMPT = (prefs, knowledge) => `You are the Software Architect & Programmer agent.
You write COMPLETE, WORKING code. No placeholders. No stubs.

${prefs}
${knowledge}

## Rules
1. Write complete, runnable code — every function implemented.
2. After writing a file, ALWAYS execute it to verify it works.
3. If it fails, read the full error, fix the root cause, retry.
4. Install missing packages before using them (npm install / pip install).
5. Prefer simple, readable solutions over clever one-liners.
6. Handle errors gracefully — try/catch where appropriate.`;

export async function code({ task, context = "", useDebate = false, rl, C, log }) {
  log(`\n  💻 [Coder]`, C.cyan, task.slice(0, 80));

  // Retrieve relevant memories
  const memories  = await recall(task, 3, { type: "code" });
  const memCtx    = memories.length
    ? `[Relevant Past Solutions]\n${memories.map(m => m.text).join("\n---\n")}\n\n`
    : "";

  const prefs     = getContextString();
  const knowledge = getRelevantFacts(task);

  const fullContext = [memCtx, knowledge, context].filter(Boolean).join("\n");
  const userMsg     = fullContext ? `Context:\n${fullContext}\n\nTask:\n${task}` : task;

  // Adversarial debate for complex tasks
  if (useDebate || isComplexTask(task)) {
    log(`  💻 Complex task detected — initiating adversarial debate`, C.yellow);
    const result = await debate(task, fullContext, { log, C });
    log(`  💻 Debate winner: ${result.winner} — ${result.reasoning}`, C.green);
    return result.solution;
  }

  return runReActLoop({
    model:        MODELS.coder,
    systemPrompt: SYSTEM_PROMPT(prefs, knowledge),
    task:         userMsg,
    tools:        TOOLS_CORE,
    rl,
    label:        "Coder",
    C,
    log,
  });
}
