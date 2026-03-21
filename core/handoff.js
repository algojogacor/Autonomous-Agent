// core/handoff.js
// ═══════════════════════════════════════════════════════════════
// PATTERN: Agent Handoffs — dari OpenAI Agents SDK + CrewAI
// ═══════════════════════════════════════════════════════════════
//
// OpenAI Agents SDK (March 2025, ~10K stars in weeks):
//   "Handoffs allow an agent to delegate to another agent.
//    When an agent does a handoff, it STOPS executing and the new
//    agent takes over with full context. The new agent can hand off
//    further. This creates clean agent-to-agent delegation chains."
//
// CrewAI "Flows" pattern:
//   "Combine autonomous crew collaboration with precise event-driven
//    control. Flows define explicit routing rules between agents."
//
// Microsoft AutoGen v0.4 (actor model):
//   "Agents communicate via async messages. Each agent is an actor
//    that processes one message at a time. No shared state."
//
// Implementation:
//   - HandoffResult signals "pass to agent X with this context"
//   - Orchestrator routes based on handoff signals
//   - Full conversation context passed to receiving agent
//   - Max handoff depth to prevent infinite loops

export class HandoffSignal {
  constructor(targetAgent, context, reason) {
    this.targetAgent = targetAgent;  // "coder" | "logic" | "vision" | etc
    this.context     = context;      // what the receiving agent needs to know
    this.reason      = reason;       // why we're handing off
    this.timestamp   = Date.now();
  }
}

// ── Handoff Router ─────────────────────────────────────────────
// CrewAI's "Flow" pattern — explicit routing rules
const HANDOFF_RULES = [
  {
    triggers:  [/error|bug|crash|stack trace|exception/i, /debug|fix the/i],
    target:    "logic",
    reason:    "Error analysis requires deep reasoning (DeepSeek)",
  },
  {
    triggers:  [/write.*code|build.*script|create.*function|implement/i,
                /python|javascript|bash script|powershell/i],
    target:    "coder",
    reason:    "Code generation delegated to specialized coder",
  },
  {
    triggers:  [/screenshot|click|GUI|window|desktop|screen/i],
    target:    "vision",
    reason:    "Visual interaction requires Vision agent (qwen3-vl)",
  },
  {
    triggers:  [/security|XSS|injection|vulnerability|CVE|pentest/i],
    target:    "security",
    reason:    "Security analysis delegated to Security agent",
  },
  {
    triggers:  [/slow|bottleneck|memory leak|optimize|profil/i],
    target:    "performance",
    reason:    "Performance analysis delegated to Performance agent",
  },
];

/**
 * Determine if a task should be handed off to a specialized agent.
 * Returns HandoffSignal or null.
 */
export function detectHandoff(taskText) {
  for (const rule of HANDOFF_RULES) {
    const triggered = rule.triggers.some(t => t.test(taskText));
    if (triggered) {
      return new HandoffSignal(rule.target, taskText, rule.reason);
    }
  }
  return null;
}

/**
 * Build handoff context message — preserves full conversation for receiving agent.
 * OpenAI pattern: "pass full context, not just the last message"
 */
export function buildHandoffContext(history, handoff) {
  const recentHistory = history.slice(-6); // Last 3 exchanges
  const contextParts = [
    `[HANDOFF from Orchestrator → ${handoff.targetAgent}]`,
    `Reason: ${handoff.reason}`,
    ``,
    `Recent conversation:`,
    ...recentHistory.map(m => `${m.role.toUpperCase()}: ${String(m.content).slice(0, 200)}`),
    ``,
    `Task to handle: ${handoff.context}`,
  ];
  return contextParts.join("\n");
}

/**
 * Handoff chain executor — runs handoffs with depth limit.
 * AutoGen actor model: each handoff is async and non-blocking.
 */
export async function executeHandoffChain(initialTask, agentMap, rl, C, log, maxDepth = 3) {
  let current    = initialTask;
  let depth      = 0;
  let lastResult = "";

  while (depth < maxDepth) {
    const signal = detectHandoff(current);

    if (!signal) {
      // No handoff — run with orchestrator directly
      log(`  🔄 No handoff needed, running directly`, C.gray);
      break;
    }

    const agent = agentMap[signal.targetAgent];
    if (!agent) {
      log(`  ⚠ No agent found for: ${signal.targetAgent}`, C.yellow);
      break;
    }

    log(`  🤝 Handoff → ${signal.targetAgent}: ${signal.reason}`, C.blue);
    depth++;

    try {
      lastResult = await agent({ task: current, context: lastResult, rl, C, log });
      // Check if result triggers another handoff
      current = lastResult;
    } catch (err) {
      log(`  ✗ Handoff failed: ${err.message}`, C.red);
      break;
    }
  }

  return lastResult;
}