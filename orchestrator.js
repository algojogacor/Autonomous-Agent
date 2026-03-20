// orchestrator.js — 🎯 The Manager (minimax-m2.7:cloud)
// Full hardware-aware orchestration with:
//   - ReAct loop
//   - Self-correction + RCA
//   - Adversarial debate routing
//   - Memory retrieval
//   - Confidence gating
//   - All 7 specialized agents
import { MODELS, WORKING_DIR }     from "./config.js";
import { TOOLS_ALL, EXECUTORS }    from "./tools/index.js";
import { callOllama }              from "./agents/base.js";
import { analyze  as visionRun }   from "./agents/vision.js";
import { code     as coderRun }    from "./agents/coder.js";
import { reason   as logicRun }    from "./agents/logic.js";
import { audit    as securityRun } from "./agents/security.js";
import { analyze  as perfRun }     from "./agents/performance.js";
import { auditPlan, rootCauseAnalysis } from "./core/self_correct.js";
import { confidenceGate }          from "./core/uncertainty.js";
import { recall }                  from "./memory/vectorstore.js";
import { getRelevantFacts }        from "./memory/knowledge_graph.js";
import { getContextString }        from "./memory/preferences.js";
import { AGENT }                   from "./config.js";

// ── Delegation tool definitions (Orchestrator-only) ──
const DELEGATION_TOOLS = [
  {
    type: "function",
    function: {
      name: "delegate_vision",
      description:
        "Send a visual perception task to the Vision Agent (qwen3-vl:235b). Screenshots are GPU-compressed (RTX 3050) before cloud analysis. Use for: finding GUI coordinates, reading screen text, detecting UI state, analyzing screenshots.",
      parameters: {
        type: "object",
        properties: {
          task:           { type: "string", description: "What to analyze or find visually" },
          context:        { type: "string", description: "Relevant context from previous steps" },
          screenshotPath: { type: "string", description: "Path to existing screenshot (optional)" },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_coder",
      description:
        "Send a coding task to the Coder Agent (qwen3-coder:480b). For complex tasks it auto-triggers adversarial debate with Logic agent. Use for: writing scripts, debugging, implementing features, web scraping, installing packages.",
      parameters: {
        type: "object",
        properties: {
          task:       { type: "string", description: "What to code or fix" },
          context:    { type: "string", description: "Existing code, error messages, file paths" },
          useDebate:  { type: "boolean", description: "Force adversarial debate with Logic agent" },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_logic",
      description:
        "Send a deep reasoning task to the Logic Agent (deepseek-v3.1:671b). Use for: research, root-cause analysis, hard debugging, CAPTCHA bypasses, architectural decisions, analyzing large logs.",
      parameters: {
        type: "object",
        properties: {
          task:    { type: "string", description: "Problem to reason through" },
          context: { type: "string", description: "Relevant logs, errors, background info" },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_security",
      description:
        "Run a security audit with the Security Agent. Use for: XSS/injection scanning, checking for hardcoded secrets, auth flaws, OWASP Top 10.",
      parameters: {
        type: "object",
        properties: {
          task:        { type: "string" },
          codeOrPath:  { type: "string", description: "Code string or file path to audit" },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_performance",
      description:
        "Run a performance audit with the Performance Agent. Use for: profiling CPU/memory, finding bottlenecks, optimizing database queries, reducing latency.",
      parameters: {
        type: "object",
        properties: {
          task:       { type: "string" },
          codeOrPath: { type: "string", description: "Code or file path to profile" },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "audit_plan",
      description:
        "BEFORE executing a complex or risky plan, run it through the self-correction auditor. Returns concerns, failure points, mitigations, and an improved plan.",
      parameters: {
        type: "object",
        properties: {
          plan:    { type: "string", description: "The plan to audit" },
          context: { type: "string", description: "Relevant context" },
        },
        required: ["plan"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user",
      description:
        "Pause and ask the human a question. Use ONLY for: ambiguous intent, destructive/irreversible actions, missing credentials, or low confidence (< 70%).",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string" },
        },
        required: ["question"],
      },
    },
  },
];

const ORCHESTRATOR_TOOLS = [...TOOLS_ALL, ...DELEGATION_TOOLS];

function buildSystemPrompt(memories, knowledge, prefs) {
  return `You are the PRIMARY ORCHESTRATOR of an advanced autonomous AI system.
You run on: i7-13th Gen | RTX 3050 4GB | 16GB DDR5 | Windows 11/WSL2.

## Your Specialized Team
- delegate_vision      → Vision Agent (qwen3-vl)         — Screen analysis, GUI coordinates, OCR
- delegate_coder       → Coder Agent (qwen3-coder:480b)  — Write/debug/run code (auto-debates for complex tasks)
- delegate_logic       → Logic Agent (deepseek:671b)     — Deep research, RCA, hard reasoning
- delegate_security    → Security Agent                   — XSS/injection/OWASP audits
- delegate_performance → Performance Agent                — CPU/memory/latency profiling
- audit_plan           → Self-Correction Auditor          — Review your plan before risky execution

## Your Own Tools
execute_bash, execute_bash_parallel, read_file, write_file, patch_file, list_directory,
web_search, fetch_url, call_api, take_screenshot, mouse_click, mouse_move, mouse_scroll,
keyboard_type, save_progress, recall_memory, learn_fact, query_knowledge

## Hardware Advantages
- Use execute_bash_parallel for independent commands (runs on i7 P-cores simultaneously)
- Screenshots are auto GPU-compressed (RTX 3050) — no need to manually resize
- Memory is vector-indexed in 16GB DDR5 RAM — use recall_memory before re-researching

## ReAct Protocol
THOUGHT: [Your reasoning — be explicit]
ACTION: [Tool to call or FINAL_ANSWER]

For every complex task:
1. THOUGHT: Decompose the goal into a sequential plan
2. Call audit_plan on risky or multi-step plans
3. Execute steps, using the right agent for each
4. VERIFY each step completed correctly before the next
5. Use recall_memory to avoid re-doing work

## Memory & Knowledge
${memories.length ? `\n[Relevant Past Experience]\n${memories.map(m => `- ${m.text}`).join("\n")}` : "No relevant past experience yet."}
${knowledge || ""}

## User Preferences
${prefs}

## Safety Rules
- Use ask_user before: rm -rf, force-push, sending emails, irreversible changes
- Confidence < 70% on a task → ask_user
- Always verify destructive operations before execution

Working directory: ${WORKING_DIR}`;
}

// ── Main Orchestrator Run ────────────────────────────
export async function runOrchestrator({ userMessage, history, rl, C, log }) {
  // Load relevant context
  const [memories, knowledge, prefs] = await Promise.all([
    recall(userMessage, 4),
    Promise.resolve(getRelevantFacts(userMessage)),
    Promise.resolve(getContextString()),
  ]);

  const sysPrompt = buildSystemPrompt(memories, knowledge, prefs);

  history.push({ role: "user", content: userMessage });

  const messages = [
    { role: "system", content: sysPrompt },
    ...history,
  ];

  let delegations = 0;

  for (let turn = 0; turn < AGENT.maxIterations; turn++) {
    log(`\n[Orchestrator | Turn ${turn + 1}]`, C.blue, "");

    let response;
    try {
      response = await callOllama(MODELS.orchestrator, messages, ORCHESTRATOR_TOOLS);
    } catch (err) {
      log("✗ Orchestrator:", C.red, err.message);
      log("  → Is Ollama running? Try: ollama serve", C.yellow);
      return;
    }

    const msg = response.choices?.[0]?.message;
    if (!msg) { log("✗ Empty response", C.red); break; }

    messages.push(msg);
    history.push(msg);

    // Print thought + text
    if (msg.content?.trim()) {
      const thought = msg.content.match(/THOUGHT:\s*([\s\S]+?)(?=ACTION:|$)/i)?.[1]?.trim();
      if (thought) log(`  💭`, C.gray, thought.slice(0, 180));

      const isAnswer = msg.content.includes("FINAL_ANSWER") || !msg.tool_calls?.length;
      if (isAnswer) {
        log("\n🤖 Orchestrator:", C.green, "");
        const answer = msg.content.replace(/THOUGHT:[\s\S]+?(?=ANSWER:|$)/i, "").replace(/ACTION:\s*FINAL_ANSWER/i, "").replace(/ANSWER:/i, "").trim();
        console.log(`\x1b[37m${answer || msg.content}\x1b[0m`);
      }
    }

    const toolCalls = msg.tool_calls;
    if (!toolCalls?.length) break;

    // Execute all tool calls
    for (const tc of toolCalls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}

      const name = tc.function.name;
      let result;

      try {
        switch (name) {
          case "delegate_vision":
            delegations++;
            log(`\n  → Delegating to 👁 Vision`, C.magenta, args.task?.slice(0, 60));
            result = await visionRun({ ...args, rl, C, log });
            break;

          case "delegate_coder":
            delegations++;
            log(`\n  → Delegating to 💻 Coder`, C.cyan, args.task?.slice(0, 60));
            result = await coderRun({ ...args, rl, C, log });
            break;

          case "delegate_logic":
            delegations++;
            log(`\n  → Delegating to 🧠 Logic`, C.magenta, args.task?.slice(0, 60));
            result = await logicRun({ ...args, rl, C, log });
            break;

          case "delegate_security":
            delegations++;
            log(`\n  → Delegating to 🔒 Security`, C.red, args.task?.slice(0, 60));
            result = await securityRun({ ...args, rl, C, log });
            break;

          case "delegate_performance":
            delegations++;
            log(`\n  → Delegating to ⚡ Performance`, C.yellow, args.task?.slice(0, 60));
            result = await perfRun({ ...args, rl, C, log });
            break;

          case "audit_plan":
            log(`\n  → 🔍 Auditing plan (self-correction)`, C.blue);
            result = await auditPlan(args);
            if (!result.approved) {
              log(`  ⚠ Plan concerns:`, C.yellow, result.concerns.join(", "));
            }
            break;

          case "ask_user": {
            const gate = await confidenceGate({
              action: args.question,
              task:   userMessage,
              rl, log, C,
            });
            if (!gate.proceed) {
              result = { answer: "User declined", cancelled: true };
            } else {
              log(`\n❓`, C.magenta, args.question);
              const answer = await new Promise(r =>
                rl.question(`\x1b[36mYour answer: \x1b[0m`, r)
              );
              result = { answer };
            }
            break;
          }

          default: {
            // Regular tool
            log(`  ⚙ [${name}]`, C.yellow, JSON.stringify(args).slice(0, 100));

            // Confidence gate for destructive actions
            const gate = await confidenceGate({
              action: `${name}: ${JSON.stringify(args)}`,
              task:   userMessage,
              rl, log, C,
            });

            if (!gate.proceed) {
              result = { cancelled: true, reason: gate.reason };
            } else {
              const fn = EXECUTORS[name];
              result = fn
                ? await fn(args).catch(e => ({ error: e.message }))
                : { error: `Unknown tool: ${name}` };

              // Auto RCA on failures
              if ((result?.exit_code > 0 || result?.error) && AGENT.rcaEnabled) {
                log(`  🔍 Auto RCA triggered`, C.yellow);
                const rca = await rootCauseAnalysis({
                  tool:    name,
                  command: JSON.stringify(args),
                  error:   result.stderr || result.error || "",
                });
                result._rca = rca;
                log(`  💡 RCA:`, C.cyan, rca.fix);
              }
            }
            console.log(`\x1b[90m  ✓ ${JSON.stringify(result).slice(0, 200)}\x1b[0m`);
          }
        }
      } catch (err) {
        result = { error: err.message };
        log(`  ✗ ${name} threw:`, C.red, err.message);
      }

      messages.push({
        role:         "tool",
        tool_call_id: tc.id,
        name,
        content:      typeof result === "string" ? result : JSON.stringify(result),
      });
    }

    if (delegations >= AGENT.maxDelegations) {
      log("⚠ Max sub-agent delegations reached.", C.yellow);
    }
  }
}
