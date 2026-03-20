// orchestrator.js — Master Orchestrator (minimax-m2.7:cloud)
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
import { recall }                          from "./memory/vectorstore.js";
import { getRelevantFacts }                from "./memory/knowledge_graph.js";
import { getContextString }                from "./memory/preferences.js";

const DELEGATION_TOOLS = [
  {
    type: "function",
    function: {
      name: "delegate_vision",
      description: "Send visual/GUI task to Vision Agent (qwen3-vl). Use for: screenshots, click coordinates, reading screen text.",
      parameters: { type: "object", properties: { task: { type: "string" }, context: { type: "string" }, screenshotPath: { type: "string" } }, required: ["task"] },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_coder",
      description: "Send coding task to Coder Agent (qwen3-coder:480b). Use for: writing scripts, fixing bugs, building scrapers, running code.",
      parameters: { type: "object", properties: { task: { type: "string" }, context: { type: "string" }, useDebate: { type: "boolean" } }, required: ["task"] },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_logic",
      description: "Send hard reasoning task to Logic Agent (deepseek-v3.1:671b). Use for: research, root-cause analysis, debugging errors.",
      parameters: { type: "object", properties: { task: { type: "string" }, context: { type: "string" } }, required: ["task"] },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_security",
      description: "Run security audit. Use for: XSS/injection scanning, hardcoded secrets, OWASP checks.",
      parameters: { type: "object", properties: { task: { type: "string" }, codeOrPath: { type: "string" } }, required: ["task"] },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_performance",
      description: "Run performance audit. Use for: CPU/memory profiling, query optimization, bottlenecks.",
      parameters: { type: "object", properties: { task: { type: "string" }, codeOrPath: { type: "string" } }, required: ["task"] },
    },
  },
  {
    type: "function",
    function: {
      name: "audit_plan",
      description: "Run self-correction auditor on a plan BEFORE executing risky multi-step operations.",
      parameters: { type: "object", properties: { plan: { type: "string" }, context: { type: "string" } }, required: ["plan"] },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user",
      description: "Ask the human a question. Use ONLY for destructive/irreversible actions or truly missing info.",
      parameters: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
    },
  },
];

const ALL_TOOLS = [...TOOLS_ALL, ...DELEGATION_TOOLS];

function buildSystemPrompt(memories, knowledge, prefs) {
  const memCtx = memories.length
    ? "\n[Relevant Past Experience]\n" + memories.map(m => "- " + m.text).join("\n")
    : "";

  return `You are an autonomous AI agent on Windows 11. Execute tasks immediately using tools.

CRITICAL RULES:
1. CALL TOOLS IMMEDIATELY. Never describe what you will do — just do it.
2. After every tool result, call the next tool right away.
3. When creating files (Word docs, CSVs, reports), ALWAYS tell the user the full save path at the end.
4. ask_user ONLY for: rm -rf, deleting important data, sending emails/messages.
5. When task is done, summarize: what was done + where output files are saved.

TOOLS YOU MUST USE (call them, don't describe them):
execute_bash, execute_bash_parallel, read_file, write_file, patch_file,
list_directory, web_search, fetch_url, call_api,
take_screenshot, mouse_click, keyboard_type,
save_progress, recall_memory, learn_fact, query_knowledge,
delegate_vision, delegate_coder, delegate_logic,
delegate_security, delegate_performance, audit_plan

Hardware: i7-13th Gen | RTX 3050 4GB | 16GB DDR5 | Windows 11
Working directory: ${WORKING_DIR}
${memCtx}${knowledge ? "\n" + knowledge : ""}${prefs ? "\nUser preferences:\n" + prefs : ""}`;
}

export async function runOrchestrator({ userMessage, history, rl, C, log }) {
  const [memories, knowledge, prefs] = await Promise.all([
    recall(userMessage, 4),
    Promise.resolve(getRelevantFacts(userMessage)),
    Promise.resolve(getContextString()),
  ]);

  const sysPrompt = buildSystemPrompt(memories, knowledge, prefs);

  const messages = [
    { role: "system", content: sysPrompt },
    ...history,
    { role: "user", content: userMessage },
  ];
  history.push({ role: "user", content: userMessage });

  let delegations = 0;
  let textOnlyTurns = 0; // track consecutive turns with no tool calls

  for (let turn = 0; turn < AGENT.maxIterations; turn++) {
    log("\n[Orchestrator | Turn " + (turn + 1) + "]", C.blue, "");

    let response;
    try {
      response = await callOllama(MODELS.orchestrator, messages, ALL_TOOLS);
    } catch (err) {
      log("✗ Orchestrator:", C.red, err.message);
      log("  → Is Ollama running? Try: ollama serve", C.yellow);
      return;
    }

    const msg = response.message;
    if (!msg) { log("✗ Empty response", C.red); break; }

    // Show thinking if available
    if (msg.thinking) {
      log("  💭", C.gray, msg.thinking.slice(0, 200));
    }

    const assistantMsg = { role: "assistant", content: msg.content || "", tool_calls: msg.tool_calls };
    messages.push(assistantMsg);
    history.push(assistantMsg);

    // Get tool calls — native first, then text fallback
    let toolCalls = msg.tool_calls || [];

    if (!toolCalls.length && msg.content) {
      const parsed = parseTextToolCalls(msg.content);
      if (parsed.length) {
        log("  ⚡ Parsed " + parsed.length + " tool call(s) from text", C.yellow);
        toolCalls = parsed;
      }
    }

    // Print text content
    if (msg.content?.trim() && !toolCalls.length) {
      log("\n🤖 Orchestrator:", C.green, "");
      console.log("\x1b[37m" + msg.content + "\x1b[0m");
    }

    // If no tool calls and model just talked → nudge it to act
    if (!toolCalls.length) {
      textOnlyTurns++;
      if (textOnlyTurns >= 2) {
        log("  ⚠ Model not calling tools. Nudging...", C.yellow);
        break;
      }
      // Push a nudge message
      messages.push({
        role:    "user",
        content: "Execute the task now. Call the appropriate tools immediately. Do not describe — just call tools.",
      });
      continue;
    }

    textOnlyTurns = 0;

    // Execute all tool calls
    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let args = tc.function?.arguments || {};
      if (typeof args === "string") {
        try { args = JSON.parse(args); } catch { args = {}; }
      }

      let result;

      try {
        switch (name) {
          case "delegate_vision":
            delegations++;
            log("\n  → 👁 Vision", C.magenta, (args.task || "").slice(0, 70));
            result = await visionRun({ ...args, rl, C, log });
            break;

          case "delegate_coder":
            delegations++;
            log("\n  → 💻 Coder", C.cyan, (args.task || "").slice(0, 70));
            result = await coderRun({ ...args, rl, C, log });
            break;

          case "delegate_logic":
            delegations++;
            log("\n  → 🧠 Logic", C.magenta, (args.task || "").slice(0, 70));
            result = await logicRun({ ...args, rl, C, log });
            break;

          case "delegate_security":
            delegations++;
            log("\n  → 🔒 Security", C.red, (args.task || "").slice(0, 70));
            result = await securityRun({ ...args, rl, C, log });
            break;

          case "delegate_performance":
            delegations++;
            log("\n  → ⚡ Performance", C.yellow, (args.task || "").slice(0, 70));
            result = await perfRun({ ...args, rl, C, log });
            break;

          case "audit_plan":
            log("\n  → 🔍 Auditing plan", C.blue);
            result = await auditPlan(args);
            if (!result.approved) log("  ⚠ Concerns:", C.yellow, (result.concerns || []).join(", "));
            break;

          case "ask_user": {
            const gate = await confidenceGate({ action: args.question, toolName: "ask_user", task: userMessage, rl, log, C });
            if (!gate.proceed) {
              result = { answer: "User declined", cancelled: true };
            } else {
              log("\n❓", C.magenta, args.question);
              const answer = await new Promise(r => rl.question("\x1b[36mYour answer: \x1b[0m", r));
              result = { answer };
            }
            break;
          }

          default: {
            log("  ⚙ [" + name + "]", C.yellow, JSON.stringify(args).slice(0, 100));
            const gate = await confidenceGate({ action: JSON.stringify(args), toolName: name, task: userMessage, rl, log, C });
            if (!gate.proceed) {
              result = { cancelled: true, reason: gate.reason };
            } else {
              const fn = EXECUTORS[name];
              result = fn
                ? await fn(args).catch(e => ({ error: e.message }))
                : { error: "Unknown tool: " + name };

              if (AGENT.rcaEnabled && (result?.exit_code > 0 || result?.error)) {
                log("  🔍 RCA triggered", C.yellow);
                const rca = await rootCauseAnalysis({
                  tool: name, command: JSON.stringify(args),
                  error: result.stderr || result.error || "",
                });
                result._rca = rca;
                log("  💡 Fix:", C.cyan, rca.fix);
              }
            }
            console.log("\x1b[90m  ✓ " + JSON.stringify(result).slice(0, 200) + "\x1b[0m");
          }
        }
      } catch (err) {
        result = { error: err.message };
        log("  ✗ " + name + ":", C.red, err.message);
      }

      // Ollama native tool result format
      messages.push({
        role:      "tool",
        tool_name: name,
        content:   typeof result === "string" ? result : JSON.stringify(result),
      });
    }

    if (delegations >= AGENT.maxDelegations) {
      log("⚠ Max delegations reached.", C.yellow);
    }
  }
}