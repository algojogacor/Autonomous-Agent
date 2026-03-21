// orchestrator.js — Master Orchestrator
// Implements Eigent's 4 key patterns:
//   1. Complexity Gate    → simple questions answered instantly, no tools
//   2. Task Decomposition → break complex tasks into subtasks before executing
//   3. 30s Auto-confirm   → show plan to user, auto-proceed
//   4. Parallel Execution → run independent subtasks with Promise.all()
import { MODELS, WORKING_DIR, AGENT }      from "./config.js";
import { TOOLS_ALL, EXECUTORS }            from "./tools/index.js";
import { callOllama }                      from "./agents/base.js";
import { analyze  as visionRun }           from "./agents/vision.js";
import { code     as coderRun }            from "./agents/coder.js";
import { reason   as logicRun }            from "./agents/logic.js";
import { audit    as securityRun }         from "./agents/security.js";
import { analyze  as perfRun }             from "./agents/performance.js";
import { auditPlan, rootCauseAnalysis }    from "./core/self_correct.js";
import { confidenceGate }                  from "./core/uncertainty.js";
import { parseTextToolCalls }              from "./core/tool_parser.js";
import { classifyTask, decomposeTasks, showPlanAndConfirm, executeSubtasks } from "./core/task_decomposer.js";
import { evaluateAndOptimize }                             from "./core/evaluator.js";
import { validateInput, validateOutput, detectPII }        from "./core/guardrails.js";
import { detectHandoff, buildHandoffContext }               from "./core/handoff.js";
import { selectCrew, runCrewPipeline }                     from "./core/crew.js";
import { compressHistory, slidingWindow, estimateTokens }  from "./core/context_manager.js";
import { recall }                          from "./memory/vectorstore.js";
import { getRelevantFacts }                from "./memory/knowledge_graph.js";
import { getContextString }                from "./memory/preferences.js";

// Agent function map for parallel executor
const AGENT_MAP = {
  orchestrator: ({ task, context, rl, C, log }) => runDirectLoop({ task, context, rl, C, log }),
  coder:        ({ task, context, rl, C, log }) => coderRun({ task, context, rl, C, log }),
  logic:        ({ task, context, rl, C, log }) => logicRun({ task, context, rl, C, log }),
  vision:       ({ task, context, rl, C, log }) => visionRun({ task, context, rl, C, log }),
  security:     ({ task, context, rl, C, log }) => securityRun({ task, context, rl, C, log }),
  performance:  ({ task, context, rl, C, log }) => perfRun({ task, context, rl, C, log }),
};

const DELEGATION_TOOLS = [
  {
    type: "function",
    function: {
      name: "delegate_vision",
      description: "Send visual/GUI task to Vision Agent (qwen3-vl). Screenshots, click coordinates, screen text.",
      parameters: { type: "object", properties: { task: { type: "string" }, context: { type: "string" } }, required: ["task"] },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_coder",
      description: "Send coding task to Coder Agent (qwen3-coder:480b). Write/debug/run code, scraping, scripts.",
      parameters: { type: "object", properties: { task: { type: "string" }, context: { type: "string" }, useDebate: { type: "boolean" } }, required: ["task"] },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_logic",
      description: "Send reasoning task to Logic Agent (deepseek-v3.1:671b). Research, RCA, hard debugging.",
      parameters: { type: "object", properties: { task: { type: "string" }, context: { type: "string" } }, required: ["task"] },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_security",
      description: "Security audit: XSS, injections, secrets, OWASP.",
      parameters: { type: "object", properties: { task: { type: "string" }, codeOrPath: { type: "string" } }, required: ["task"] },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_performance",
      description: "Performance audit: CPU, memory, bottlenecks.",
      parameters: { type: "object", properties: { task: { type: "string" }, codeOrPath: { type: "string" } }, required: ["task"] },
    },
  },
  {
    type: "function",
    function: {
      name: "audit_plan",
      description: "Self-correction: review a plan before risky execution.",
      parameters: { type: "object", properties: { plan: { type: "string" }, context: { type: "string" } }, required: ["plan"] },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user",
      description: "Ask human. ONLY for: rm -rf, deleting data, sending emails, irreversible actions.",
      parameters: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
    },
  },
];

const ALL_TOOLS = [...TOOLS_ALL, ...DELEGATION_TOOLS];

function buildSystemPrompt(memories, knowledge, prefs) {
  const memCtx = memories.length
    ? "\n[Relevant Past Experience]\n" + memories.map(m => "- " + m.text).join("\n")
    : "";
  return `You are an autonomous AI agent on Windows 11.

RULES:
1. CALL TOOLS IMMEDIATELY — never describe, just execute.
2. After every tool result, call the next tool right away.
3. When creating files, ALWAYS state the full save path in your final response.
4. ask_user ONLY for rm -rf, deleting data, or sending messages.
5. When done: summarize what was done + where files were saved.
6. Use execute_bash_parallel for commands that don't depend on each other.

SEARCH: If you already know the answer (facts, lists, static data), answer directly. Only web_search for real-time data.
${memCtx}${knowledge ? "\n" + knowledge : ""}${prefs ? "\nUser preferences:\n" + prefs : ""}
Working directory: ${WORKING_DIR}`;
}

// ── Direct tool loop (for orchestrator-handled subtasks) ──────────
async function runDirectLoop({ task, context, rl, C, log }) {
  const messages = [
    { role: "system", content: buildSystemPrompt([], "", "") },
    { role: "user",   content: context ? `Context:\n${context}\n\nTask: ${task}` : task },
  ];

  for (let turn = 0; turn < AGENT.maxIterations; turn++) {
    let response;
    try {
      response = await callOllama(MODELS.orchestrator, messages, ALL_TOOLS);
    } catch (err) {
      return `ERROR: ${err.message}`;
    }

    const msg = response.message;
    if (!msg) break;

    messages.push({ role: "assistant", content: msg.content || "", tool_calls: msg.tool_calls });

    let toolCalls = msg.tool_calls || [];
    if (!toolCalls.length && msg.content) {
      toolCalls = parseTextToolCalls(msg.content);
    }

    if (!toolCalls.length) return msg.content || "";

    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let args = tc.function?.arguments || {};
      if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }

      log(`  ⚙ [${name}]`, C.yellow, JSON.stringify(args).slice(0, 100));
      const gate = await confidenceGate({ action: JSON.stringify(args), toolName: name, task, rl, log, C });
      let result;
      if (!gate.proceed) {
        result = { cancelled: true, reason: gate.reason };
      } else {
        const fn = EXECUTORS[name];
        result = fn ? await fn(args).catch(e => ({ error: e.message })) : { error: `Unknown tool: ${name}` };
        if (AGENT.rcaEnabled && (name === "execute_bash" || name === "execute_bash_parallel") && (result?.exit_code > 0 || result?.error)) {
          const rca = await rootCauseAnalysis({ tool: name, command: JSON.stringify(args), error: result.stderr || result.error || "" });
          result._rca = rca;
          log(`  💡 RCA fix:`, C.cyan, rca.fix);
        }
      }
      console.log(`\x1b[90m  ✓ ${JSON.stringify(result).slice(0, 200)}\x1b[0m`);
      messages.push({ role: "tool", tool_name: name, content: JSON.stringify(result) });
    }
  }
  return "";
}

// ── Main Orchestrator ─────────────────────────────────────────────
export async function runOrchestrator({ userMessage, history, rl, C, log }) {
  // ── INPUT GUARDRAIL (OpenAI Agents SDK pattern) ──────────────
  const inputCheck = validateInput(userMessage);
  if (!inputCheck.safe) {
    log("\n🛡 Guardrail blocked:", C.red, inputCheck.message);
    log("  Risk:", C.yellow, inputCheck.risk);
    console.log("\x1b[37mPermintaan ini tidak dapat diproses karena terdeteksi sebagai berisiko tinggi.\x1b[0m");
    return;
  }

  // ── CONTEXT COMPRESSION (Anthropic + AutoGen pattern) ──────────
  if (history.length > 20) {
    history = slidingWindow(history, 12);
    log("  📎 Context compressed (sliding window)", C.gray);
  }

  const [memories, knowledge, prefs] = await Promise.all([
    recall(userMessage, 4),
    Promise.resolve(getRelevantFacts(userMessage)),
    Promise.resolve(getContextString()),
  ]);

  history.push({ role: "user", content: userMessage });

  // ── STEP 1: Complexity Gate (Eigent's question_confirm_agent) ──
  log("\n⚡ Classifying task...", C.gray);
  const { type, reason } = await classifyTask(userMessage);
  log(`  → ${type}${reason ? ` (${reason})` : ""}`, C.gray);

  // ── STEP 2a: SIMPLE → answer directly from knowledge ───────────
  if (type === "SIMPLE") {
    log("\n🤖 Orchestrator:", C.green, "(direct answer)");
    const resp = await callOllama(MODELS.orchestrator, [
      { role: "system", content: "You are a helpful assistant. Answer directly and concisely in the same language as the question." },
      ...history,
    ]);
    const answer = resp.message?.content || "";
    console.log(`\x1b[37m${answer}\x1b[0m`);
    history.push({ role: "assistant", content: answer });
    return;
  }

  // ── STEP 2b: COMPLEX → check handoff first (OpenAI pattern) ─────
  const handoff = detectHandoff(userMessage);
  if (handoff) {
    log(`\n🤝 Auto-handoff → ${handoff.targetAgent}: ${handoff.reason}`, C.blue);
    const agentFn = AGENT_MAP[handoff.targetAgent];
    if (agentFn) {
      const handoffContext = buildHandoffContext(history, handoff);
      const result = await agentFn({ task: userMessage, context: handoffContext, rl, C, log });
      // Evaluator-optimizer on result (Anthropic pattern)
      const optimized = await evaluateAndOptimize(userMessage, result, { log, C });
      log("\n🤖 Result:", C.green, "");
      console.log("\x1b[37m" + optimized + "\x1b[0m");
      history.push({ role: "assistant", content: optimized });
      return;
    }
  }

  // ── STEP 2c: COMPLEX → decompose into subtasks ───────────────────
  log("\n📐 Decomposing task...", C.blue);
  const subtasks = await decomposeTasks(userMessage, knowledge);

  if (subtasks && subtasks.length > 1) {
    // ── STEP 3: Show plan + 30s auto-confirm (Eigent's TO_SUB_TASKS) ─
    const { confirmed, subtasks: confirmedSubtasks } = await showPlanAndConfirm(subtasks, rl, C, log);

    if (confirmed) {
      // ── STEP 4: Parallel execution (Eigent's worker swarm) ──────
      log("\n🚀 Executing plan...", C.green);
      const results = await executeSubtasks(confirmedSubtasks, AGENT_MAP, rl, C, log);

      // Collect all results and summarize
      const resultTexts = [...results.values()]
        .filter(r => r.status === "done" && r.result)
        .map(r => String(r.result).slice(0, 300));

      // Final summary from orchestrator
      log("\n🤖 Summary:", C.green, "");
      const summaryResp = await callOllama(MODELS.orchestrator, [
        { role: "system", content: "Summarize the completed work. Mention file paths if any were created. Be concise." },
        { role: "user", content: `Original task: ${userMessage}\n\nResults:\n${resultTexts.join("\n---\n")}` },
      ]);
      const summary = summaryResp.message?.content || "Task completed.";
      console.log(`\x1b[37m${summary}\x1b[0m`);
      history.push({ role: "assistant", content: summary });
      return;
    }
  }

  // ── Fallback: single-loop execution (no decomposition) ──────────
  log("\n[Orchestrator | Direct Execution]", C.blue, "");
  const messages = [
    { role: "system", content: buildSystemPrompt(memories, knowledge, prefs) },
    ...history,
  ];

  let textOnlyTurns = 0;
  let delegations = 0;

  for (let turn = 0; turn < AGENT.maxIterations; turn++) {
    log(`\n[Orchestrator | Turn ${turn + 1}]`, C.blue, "");

    let response;
    try {
      response = await callOllama(MODELS.orchestrator, messages, ALL_TOOLS);
    } catch (err) {
      log("✗ Orchestrator:", C.red, err.message);
      return;
    }

    const msg = response.message;
    if (!msg) break;

    if (msg.thinking) log("  💭", C.gray, msg.thinking.slice(0, 200));

    const assistantMsg = { role: "assistant", content: msg.content || "", tool_calls: msg.tool_calls };
    messages.push(assistantMsg);
    history.push(assistantMsg);

    let toolCalls = msg.tool_calls || [];
    if (!toolCalls.length && msg.content) {
      const parsed = parseTextToolCalls(msg.content);
      if (parsed.length) { log("  ⚡ Parsed " + parsed.length + " tool call(s) from text", C.yellow); toolCalls = parsed; }
    }

    if (!toolCalls.length) {
      textOnlyTurns++;
      if (msg.content?.trim()) {
        log("\n🤖 Orchestrator:", C.green, "");
        console.log(`\x1b[37m${msg.content}\x1b[0m`);
      }
      if (textOnlyTurns >= 2) {
        messages.push({ role: "user", content: "Execute now. Call the tools immediately." });
        continue;
      }
      break;
    }

    textOnlyTurns = 0;

    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let args = tc.function?.arguments || {};
      if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }

      let result;
      try {
        switch (name) {
          case "delegate_vision":    delegations++; log("\n  → 👁 Vision", C.magenta, (args.task||"").slice(0,70)); result = await visionRun({ ...args, rl, C, log }); break;
          case "delegate_coder":     delegations++; log("\n  → 💻 Coder",  C.cyan,    (args.task||"").slice(0,70)); result = await coderRun({  ...args, rl, C, log }); break;
          case "delegate_logic":     delegations++; log("\n  → 🧠 Logic",  C.magenta, (args.task||"").slice(0,70)); result = await logicRun({  ...args, rl, C, log }); break;
          case "delegate_security":  delegations++; log("\n  → 🔒 Security", C.red,   (args.task||"").slice(0,70)); result = await securityRun({ ...args, rl, C, log }); break;
          case "delegate_performance": delegations++; log("\n  → ⚡ Perf",  C.yellow, (args.task||"").slice(0,70)); result = await perfRun({   ...args, rl, C, log }); break;
          case "audit_plan":         log("\n  → 🔍 Auditing plan", C.blue); result = await auditPlan(args); if (!result.approved) log("  ⚠", C.yellow, (result.concerns||[]).join(", ")); break;
          case "ask_user": {
            const gate = await confidenceGate({ action: args.question, toolName: "ask_user", task: userMessage, rl, log, C });
            if (!gate.proceed) { result = { answer: "User declined", cancelled: true }; break; }
            log("\n❓", C.magenta, args.question);
            const answer = await new Promise(r => rl.question("\x1b[36mYour answer: \x1b[0m", r));
            result = { answer };
            break;
          }
          default: {
            log("  ⚙ [" + name + "]", C.yellow, JSON.stringify(args).slice(0, 100));
            const gate = await confidenceGate({ action: JSON.stringify(args), toolName: name, task: userMessage, rl, log, C });
            if (!gate.proceed) { result = { cancelled: true, reason: gate.reason }; break; }
            const fn = EXECUTORS[name];
            result = fn ? await fn(args).catch(e => ({ error: e.message })) : { error: "Unknown tool: " + name };
            if (AGENT.rcaEnabled && (name === "execute_bash" || name === "execute_bash_parallel") && (result?.exit_code > 0 || result?.error)) {
              const rca = await rootCauseAnalysis({ tool: name, command: JSON.stringify(args), error: result.stderr || result.error || "" });
              result._rca = rca;
              log("  💡 Fix:", C.cyan, rca.fix);
            }
            console.log("\x1b[90m  ✓ " + JSON.stringify(result).slice(0, 200) + "\x1b[0m");
          }
        }
      } catch (err) {
        result = { error: err.message };
        log("  ✗ " + name + ":", C.red, err.message);
      }

      messages.push({ role: "tool", tool_name: name, content: typeof result === "string" ? result : JSON.stringify(result) });
    }

    if (delegations >= AGENT.maxDelegations) { log("⚠ Max delegations.", C.yellow); break; }
  }
}