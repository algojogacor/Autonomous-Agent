// core/react_loop.js — ReAct (Reason + Act) Loop Engine
//
// Uses official Ollama npm package pattern from docs:
//   1. Call model with tools
//   2. If response has tool_calls → execute them
//   3. Append results as { role: "tool", tool_name: "...", content: "..." }
//   4. Repeat until no more tool_calls
//
import { callOllama } from "../agents/base.js";
import { parseTextToolCalls } from "./tool_parser.js";
import { EXECUTORS }  from "../tools/index.js";
import { AGENT }      from "../config.js";
import { remember }   from "../memory/vectorstore.js";

/**
 * Run a ReAct agent loop until task completion.
 *
 * @param {object} opts
 * @returns {string} final text response
 */
export async function runReActLoop({
  model, systemPrompt, task, tools = [],
  history = [], rl, label, C, log, onToolCall,
}) {
  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user",   content: task },
  ];

  let finalAnswer = "";

  for (let turn = 0; turn < AGENT.maxIterations; turn++) {
    log(`\n  [${label} | Turn ${turn + 1}]`, C.blue, "");

    let response;
    try {
      response = await callOllama(model, messages, tools);
    } catch (err) {
      log(`  ✗ ${label}:`, C.red, err.message);
      return `ERROR: ${err.message}`;
    }

    const msg = response.message;
    if (!msg) break;

    // Show thinking if available (chain-of-thought)
    if (msg.thinking) {
      log(`  💭 [${label}]`, C.gray, msg.thinking.slice(0, 200));
    }

    // Append assistant message to history
    messages.push({ role: "assistant", content: msg.content || "", tool_calls: msg.tool_calls });

    // Print any text content
    if (msg.content?.trim()) {
      console.log(`\x1b[90m  [${label}]\x1b[0m ${msg.content}`);
    }

    // No tool calls → agent is done
    const toolCalls = msg.tool_calls;
    if (!toolCalls?.length) {
      finalAnswer = msg.content || "";
      await remember(task.slice(0, 100), { type: "task", result: finalAnswer.slice(0, 200) });
      break;
    }

    // Execute tool calls and collect results
    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let args   = tc.function?.arguments || {};
      // Ollama native returns arguments as object (already parsed)
      if (typeof args === "string") {
        try { args = JSON.parse(args); } catch { args = {}; }
      }

      log(`  ⚙ [${name}]`, C.yellow, JSON.stringify(args).slice(0, 100));

      let result;
      if (name === "ask_user") {
        const answer = await new Promise(r =>
          rl.question(`${C.magenta}❓ ${args.question}\n${C.cyan}Answer: ${C.reset}`, r)
        );
        result = { answer };
      } else {
        const fn = EXECUTORS[name];
        try {
          result = fn ? await fn(args) : { error: `Unknown tool: ${name}` };
        } catch (e) {
          result = { error: e.message };
        }
      }

      log(`  📋 Result:`, C.gray, JSON.stringify(result).slice(0, 200));
      if (onToolCall) onToolCall(name, args, result);

      // Ollama native tool result format (NOT OpenAI format)
      messages.push({
        role:      "tool",
        tool_name: name,
        content:   JSON.stringify(result),
      });

      if (result?.error || result?.exit_code > 0) {
        await remember(`Error in ${name}: ${result.error || result.stderr}`, { type: "error", tool: name });
      }
    }
    // Loop continues — model processes tool results
  }

  return finalAnswer;
}