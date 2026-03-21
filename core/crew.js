// core/crew.js
// ═══════════════════════════════════════════════════════════════
// PATTERN: Role-Based Crew — dari CrewAI
// ═══════════════════════════════════════════════════════════════
//
// CrewAI (5.76x faster than LangGraph in benchmarks):
//   "Agents have a ROLE, GOAL, and BACKSTORY. This shapes how they
//    think and respond — not just what tools they have. A 'Senior
//    Python Developer' thinks differently than a 'Data Analyst'
//    even if they use the same tools. The role IS the prompt."
//
// CrewAI Dual Architecture:
//   - Crew:  autonomous collaboration, emergent behavior
//   - Flow:  precise event-driven control, deterministic routing
//
// MetaGPT "software company" pattern:
//   PM → Architect → Developer → QA → Done
//   Each role produces a specific artifact.

import { callOllama } from "../agents/base.js";
import { MODELS }     from "../config.js";

// ── Crew Member Definitions ──────────────────────────────────
export const CREW_ROLES = {
  // Technical crew
  tech_lead: {
    role:      "Tech Lead & System Architect",
    goal:      "Design scalable, clean solutions and oversee technical decisions",
    backstory: "10 years of experience. You prefer simple solutions over complex ones. You always think about maintainability.",
    model:     MODELS.logic,
  },
  senior_dev: {
    role:      "Senior Full-Stack Developer",
    goal:      "Write production-quality code that actually works and is well-tested",
    backstory: "Expert in Node.js, Python, and Bash. You write clean code, handle errors properly, and always test your work.",
    model:     MODELS.coder,
  },
  qa_engineer: {
    role:      "QA Engineer",
    goal:      "Find bugs, edge cases, and verify the code works correctly",
    backstory: "Skeptical by nature. You always ask 'what could go wrong?' You test happy paths AND edge cases.",
    model:     MODELS.coder,
  },
  researcher: {
    role:      "Research Analyst",
    goal:      "Find accurate, comprehensive information from multiple sources and synthesize it clearly",
    backstory: "Thorough and methodical. You cross-reference sources and flag conflicting information.",
    model:     MODELS.logic,
  },
  // Domain crew
  data_analyst: {
    role:      "Data Analyst",
    goal:      "Extract insights from data, create structured reports and visualizations",
    backstory: "You think in tables and numbers. You always verify data quality before drawing conclusions.",
    model:     MODELS.coder,
  },
  security_expert: {
    role:      "Security Engineer",
    goal:      "Identify vulnerabilities and ensure code/systems are secure",
    backstory: "Paranoid about security. You think like an attacker to defend like a defender.",
    model:     MODELS.logic,
  },
};

/**
 * Run a single crew member on a task.
 * The role/goal/backstory shapes the LLM response quality.
 */
export async function runCrewMember(roleKey, task, context = "") {
  const member = CREW_ROLES[roleKey];
  if (!member) throw new Error(`Unknown crew role: ${roleKey}`);

  const systemPrompt = `You are a ${member.role}.

Your goal: ${member.goal}

Your background: ${member.backstory}

Always stay in character. Think and respond as this professional would.`;

  const userContent = context
    ? `Context from previous work:\n${context}\n\nYour task:\n${task}`
    : task;

  const resp = await callOllama(member.model, [
    { role: "system", content: systemPrompt },
    { role: "user",   content: userContent },
  ]);

  return resp.message?.content || "";
}

/**
 * Run a crew pipeline — MetaGPT-style sequential roles.
 * Each role receives output from the previous as context.
 *
 * @param {Array} pipeline - [{ role: "tech_lead", task: "..." }, ...]
 * @param {object} opts    - { log, C }
 * @returns {object}       - { results: Map, final: string }
 */
export async function runCrewPipeline(pipeline, opts = {}) {
  const { log = () => {}, C = {} } = opts;
  const results = new Map();
  let context   = "";

  for (const step of pipeline) {
    const member = CREW_ROLES[step.role];
    if (!member) continue;

    log(`  👤 [${member.role}]`, C.cyan || "", step.task.slice(0, 60));

    const result = await runCrewMember(step.role, step.task, context);
    results.set(step.role, result);

    // Feed this result as context to next crew member
    context = `[${member.role} output]\n${result.slice(0, 800)}`;

    if (step.onResult) step.onResult(result);
  }

  return {
    results,
    final: context,
  };
}

/**
 * Auto-select crew for a task type.
 * Returns the right pipeline based on task content.
 */
export function selectCrew(taskText) {
  if (/bug|error|crash|fix/i.test(taskText)) {
    return [
      { role: "tech_lead",  task: `Analyze this problem and design the fix: ${taskText}` },
      { role: "senior_dev", task: `Implement the fix based on tech lead's analysis` },
      { role: "qa_engineer", task: `Verify the fix is correct and test edge cases` },
    ];
  }

  if (/research|data|list|find|search/i.test(taskText)) {
    return [
      { role: "researcher",   task: taskText },
      { role: "data_analyst", task: `Structure and format the research results clearly` },
    ];
  }

  if (/build|create|write.*app|develop/i.test(taskText)) {
    return [
      { role: "tech_lead",  task: `Design the architecture for: ${taskText}` },
      { role: "senior_dev", task: `Build it based on the architecture` },
      { role: "qa_engineer", task: `Review and test the implementation` },
    ];
  }

  if (/security|hack|vuln|pentest/i.test(taskText)) {
    return [
      { role: "security_expert", task: taskText },
    ];
  }

  // Default: researcher + dev
  return [
    { role: "researcher",  task: taskText },
    { role: "senior_dev",  task: `Implement or execute based on research results` },
  ];
}