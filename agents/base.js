// agents/base.js — Ollama Native Client
import { Ollama } from "ollama";
import { OLLAMA_URL } from "../config.js";

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";

let _client;
function getClient() {
  if (!_client) _client = new Ollama({ host: OLLAMA_URL });
  return _client;
}

export async function callOllama(model, messages, tools = []) {
  const client = getClient();

  const opts = {
    model,
    messages,
    stream: false,
    // think:true disabled when tools present — causes model to exhaust tokens on reasoning
    // and produce no tool_calls. Only enable for pure reasoning (no tools).
    think: tools.length === 0,
    options: {
      num_ctx:     32768,  // Large context — no output length restriction
      temperature: 0.2,
      // NO num_predict limit — let model output as much as it needs
    },
  };

  if (tools.length) opts.tools = tools;
  if (OLLAMA_API_KEY) opts.options.web_search = true;

  try {
    return await client.chat(opts);
  } catch (err) {
    throw new Error(`Ollama [${model}]: ${err.message}`);
  }
}

export async function oneShot(model, systemPrompt, userPrompt) {
  const resp = await callOllama(model, [
    { role: "system", content: systemPrompt },
    { role: "user",   content: userPrompt   },
  ]);
  return resp.message?.content || "";
}