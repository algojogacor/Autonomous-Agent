// core/task_decomposer.js
//
// Imitasi pattern kunci dari Eigent:
//
// 1. COMPLEXITY GATE (question_confirm_agent)
//    Simple question → jawab langsung, skip worker swarm
//    Complex task    → decompose dulu, baru execute
//
// 2. DECOMPOSE_TEXT streaming
//    Sebelum execute, tampilkan "thinking" live ke user
//
// 3. TO_SUB_TASKS + 30s auto-confirm
//    Tampilkan plan subtask, user bisa edit, auto-confirm setelah 30s
//
// 4. PARALLEL EXECUTION
//    Jalankan independent subtasks serentak pakai Promise.all()
//
import { callOllama } from "../agents/base.js";
import { MODELS }     from "../config.js";

// ── 1. Complexity Gate ───────────────────────────────────────────
// Eigent: WAIT_CONFIRM = simple, TO_SUB_TASKS = complex
const SIMPLE_CLASSIFY_PROMPT = `You are a task classifier. Classify the user request as SIMPLE or COMPLEX.

SIMPLE: Can be answered in 1-2 sentences from existing knowledge, no tools needed.
  Examples: "apa itu AI", "siapa presiden RI", "translate hello to english", "jelaskan recursion"

COMPLEX: Requires tools, multi-step execution, file creation, web search, or system interaction.
  Examples: "buat file excel", "carikan data dan simpan", "rapikan folder", "install dan jalankan", "cari harga terbaru"

Respond ONLY with JSON: { "type": "SIMPLE" | "COMPLEX", "reason": "one sentence" }`;

export async function classifyTask(userMessage) {
  try {
    const resp = await callOllama(MODELS.fast, [
      { role: "system", content: SIMPLE_CLASSIFY_PROMPT },
      { role: "user",   content: userMessage },
    ]);
    const text = resp.message?.content || "";
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    return {
      type:   json.type === "SIMPLE" ? "SIMPLE" : "COMPLEX",
      reason: json.reason || "",
    };
  } catch {
    return { type: "COMPLEX", reason: "Could not classify — defaulting to complex" };
  }
}

// ── 2. Task Decomposer ───────────────────────────────────────────
// Eigent: backend streams DECOMPOSE_TEXT then fires TO_SUB_TASKS
// We: stream thinking + produce subtask list
const DECOMPOSE_PROMPT = `You are a task planner. Decompose the user's goal into 2-6 concrete, atomic subtasks.

Rules:
- Each subtask must be independently executable
- Mark subtasks that can run in parallel with "parallel: true"
- Assign the best agent for each: orchestrator | coder | logic | vision | security | performance
- Be specific — subtasks should be executable commands, not vague goals

Respond ONLY in JSON:
{
  "subtasks": [
    { "id": 1, "title": "short title", "task": "full task description", "agent": "coder|logic|vision|orchestrator", "parallel": false, "dependsOn": [] },
    ...
  ]
}`;

export async function decomposeTasks(userMessage, context = "") {
  try {
    const prompt = context
      ? `Context:\n${context}\n\nUser goal: ${userMessage}`
      : userMessage;

    const resp = await callOllama(MODELS.orchestrator, [
      { role: "system", content: DECOMPOSE_PROMPT },
      { role: "user",   content: prompt },
    ]);

    const text = resp.message?.content || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const s = clean.indexOf("{");
    const e = clean.lastIndexOf("}");
    if (s === -1 || e === -1) return null;

    const json = JSON.parse(clean.slice(s, e + 1));
    return json.subtasks || null;
  } catch {
    return null;
  }
}

// ── 3. Show Plan + Auto-confirm (30s like Eigent) ────────────────
export async function showPlanAndConfirm(subtasks, rl, C, log) {
  console.log();
  log("📋 TASK PLAN", C.cyan, `(${subtasks.length} subtasks)`);
  console.log();

  for (const st of subtasks) {
    const parallel = st.parallel ? `\x1b[90m [parallel]\x1b[0m` : "";
    const agent    = `\x1b[90m→ ${st.agent}\x1b[0m`;
    console.log(
      `  ${C.yellow}${C.bold}[${st.id}]${C.reset} ${st.title}${parallel} ${agent}`
    );
    console.log(`      ${C.reset}${st.task.slice(0, 100)}`);
  }

  console.log();
  console.log(`${C.gray}Auto-confirming in 30s... (press Enter to confirm now, type 'edit' to modify)${C.reset}`);

  // 30-second auto-confirm (same as Eigent)
  const answer = await Promise.race([
    new Promise(resolve => {
      rl.question("", resolve);
    }),
    new Promise(resolve => setTimeout(() => resolve("auto"), 30_000)),
  ]);

  if (answer === "auto") {
    log("✓ Auto-confirmed (30s timeout)", C.gray);
    return { confirmed: true, subtasks };
  }

  if (answer.trim().toLowerCase() === "edit") {
    log("✏ Edit mode — type new plan or 'skip' to proceed as-is:", C.yellow);
    const edited = await new Promise(resolve => rl.question(`${C.cyan}New plan: ${C.reset}`, resolve));
    if (edited.trim() && edited.trim() !== "skip") {
      // Re-decompose with user's edit
      const newSubtasks = await decomposeTasks(edited.trim());
      return { confirmed: true, subtasks: newSubtasks || subtasks };
    }
  }

  log("✓ Plan confirmed", C.green);
  return { confirmed: true, subtasks };
}

// ── 4. Parallel Execution Engine ─────────────────────────────────
// Eigent: workers run in parallel, each handles one subtask
// We: Promise.all() for parallel subtasks, sequential for dependent ones
export async function executeSubtasks(subtasks, agentMap, rl, C, log) {
  const results = new Map(); // id → result

  // Group by dependency waves (like Eigent's worker assignment)
  const waves = buildExecutionWaves(subtasks);

  for (const wave of waves) {
    const waveLabel = wave.map(s => `[${s.id}] ${s.title}`).join(", ");
    log(`\n⚡ Wave: ${waveLabel}`, C.blue, wave.length > 1 ? "(parallel)" : "");

    // Run wave in parallel
    const waveResults = await Promise.all(
      wave.map(async subtask => {
        log(`  ▶ [${subtask.id}] ${subtask.title}`, C.cyan, `→ ${subtask.agent}`);
        const agentFn = agentMap[subtask.agent] || agentMap["orchestrator"];
        try {
          const result = await agentFn({
            task:    subtask.task,
            context: buildContext(subtask, results),
            rl, C, log,
          });
          log(`  ✓ [${subtask.id}] Done`, C.green);
          return { id: subtask.id, result, status: "done" };
        } catch (err) {
          log(`  ✗ [${subtask.id}] Failed: ${err.message}`, C.red);
          return { id: subtask.id, result: null, status: "failed", error: err.message };
        }
      })
    );

    for (const r of waveResults) {
      results.set(r.id, r);
    }
  }

  return results;
}

// Build sequential waves from dependency graph
function buildExecutionWaves(subtasks) {
  const waves    = [];
  const done     = new Set();
  let remaining  = [...subtasks];

  while (remaining.length > 0) {
    // Find subtasks whose dependencies are all done
    const wave = remaining.filter(s => {
      const deps = s.dependsOn || [];
      return deps.every(d => done.has(Number(d)));
    });

    if (wave.length === 0) {
      // Circular dependency or all done — push rest
      waves.push(remaining);
      break;
    }

    waves.push(wave);
    wave.forEach(s => done.add(s.id));
    remaining = remaining.filter(s => !done.has(s.id));
  }

  return waves;
}

function buildContext(subtask, results) {
  if (!subtask.dependsOn?.length) return "";
  const parts = [];
  for (const depId of subtask.dependsOn) {
    const dep = results.get(Number(depId));
    if (dep?.result) parts.push(`[Result of step ${depId}]\n${String(dep.result).slice(0, 500)}`);
  }
  return parts.join("\n\n");
}