// agents/base.js — Shared Agent Engine
import { OLLAMA_URL, AGENT } from "../config.js";

/**
 * Call Ollama's OpenAI-compatible chat completions API.
 */
export async function callOllama(model, messages, tools = []) {
  const url  = `${OLLAMA_URL}/v1/chat/completions`;
  const body = {
    model,
    messages,
    max_tokens: AGENT.maxIterations * 200,
    stream:     false,
    ...(tools.length ? { tools, tool_choice: "auto" } : {}),
  };

  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama [${model}] HTTP ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Simple one-shot call (no tool loop). Good for classification, scoring, JSON tasks.
 */
export async function oneShot(model, systemPrompt, userPrompt) {
  const resp = await callOllama(model, [
    { role: "system", content: systemPrompt },
    { role: "user",   content: userPrompt },
  ]);
  return resp.choices?.[0]?.message?.content || "";
}
