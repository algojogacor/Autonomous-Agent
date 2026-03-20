// core/react_loop.js — ReAct (Reason + Act) Loop Engine
// Implements the standard ReAct pattern:
//   THOUGHT → ACTION → OBSERVATION → THOUGHT → ...
// Each turn the model explicitly reasons before acting.
import { callOllama }   from "../agents/base.js";
import { EXECUTORS }    from "../tools/index.js";
import { AGENT }        from "../config.js";
import { remember }     from "../memory/vectorstore.js";

/**
 * Run a ReAct loop for an agent.
 *
 * @param {object} params
 * @param {string} params.model
 * @param {string} params.systemPrompt
 * @param {string} params.task
 * @param {Array}  params.tools
 * @param {Array}  params.history  - Conversation history (mutated in place)
 * @param {object} params.rl       - readline interface
 * @param {string} params.label
 * @param {object} params.C        - color codes
 * @param {Function} params.log
 * @param {Function} params.onToolCall - optional hook: (name, args, result) => void
 * @returns {string} final answer
 */
export async function runReActLoop({
  model, systemPrompt, task, tools = [], history = [],
  rl, label, C, log, onToolCall,
}) {
  const REACT_PREFIX = `
You MUST follow the ReAct format STRICTLY for every response:

THOUGHT: [Reason about what to do next. Be explicit about your plan.]
ACTION: [Which tool to call, or "FINAL_ANSWER" if done]

If using a tool, output a tool_call JSON block.
If done, output:
THOUGHT: [Final reasoning]
ACTION: FINAL_ANSWER
ANSWER: [Your complete response to the user]`;

  const fullSystem = `${systemPrompt}\n${REACT_PREFIX}`;
  const messages   = [
    { role: "system",  content: fullSystem },
    ...history,
    { role: "user",    content: task },
  ];

  let finalAnswer = "";

  for (let turn = 0; turn < AGENT.maxIterations; turn++) {
    log(`\n  [${label} | ReAct Turn ${turn + 1}]`, C.blue, "");

    let resp;
    try {
      resp = await callOllama(model, messages, tools);
    } catch (err) {
      log(`  ✗ ${label}:`, C.red, err.message);
      return `ERROR: ${err.message}`;
    }

    const msg = resp.choices?.[0]?.message;
    if (!msg) break;

    messages.push(msg);

    // Print thought
    const text = msg.content || "";
    if (text.trim()) {
      const thoughtMatch = text.match(/THOUGHT:\s*([\s\S]+?)(?=ACTION:|$)/i);
      if (thoughtMatch) {
        log(`  💭 THOUGHT:`, C.gray, thoughtMatch[1].trim().slice(0, 200));
      }

      // Check for FINAL_ANSWER
      const answerMatch = text.match(/ANSWER:\s*([\s\S]+)/i);
      if (answerMatch || text.includes("FINAL_ANSWER")) {
        finalAnswer = answerMatch ? answerMatch[1].trim() : text;
        // Remember this interaction
        await remember(task, { type: "task", result: finalAnswer.slice(0, 200) });
        break;
      }
    }

    // Handle tool calls
    const toolCalls = msg.tool_calls;
    if (!toolCalls?.length) {
      finalAnswer = text;
      break;
    }

    // Execute each tool call
    const observations = [];
    for (const tc of toolCalls) {
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || "{}"); } catch {}

      const name = tc.function?.name;
      log(`  ⚙ ACTION [${name}]`, C.yellow, JSON.stringify(args).slice(0, 100));

      const fn = EXECUTORS[name];
      let result;
      if (fn) {
        try { result = await fn(args); }
        catch (e) { result = { error: e.message }; }
      } else if (name === "ask_user") {
        const answer = await new Promise(r =>
          rl.question(`${C.magenta}❓ ${args.question}\n${C.cyan}Answer: ${C.reset}`, r)
        );
        result = { answer };
      } else {
        result = { error: `Unknown tool: ${name}` };
      }

      const resultStr = JSON.stringify(result);
      log(`  📋 OBSERVATION:`, C.gray, resultStr.slice(0, 200));

      observations.push({
        role:         "tool",
        tool_call_id: tc.id,
        name,
        content:      resultStr,
      });

      if (onToolCall) onToolCall(name, args, result);

      // Remember errors for RCA
      if (result.error || result.exit_code > 0) {
        await remember(`Error in ${name}: ${resultStr}`, { type: "error", tool: name });
      }
    }

    messages.push(...observations);
  }

  return finalAnswer;
}
