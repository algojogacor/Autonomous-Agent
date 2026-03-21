// core/context_manager.js
// ═══════════════════════════════════════════════════════════════
// PATTERN: Context Window Management — dari Anthropic + AutoGen
// ═══════════════════════════════════════════════════════════════
//
// Anthropic "Building Effective Agents":
//   "For long-running agents, manage context windows carefully.
//    Summarize completed work to free tokens. Keep only what's
//    needed for the next action. Don't let the context fill with
//    repetitive tool results."
//
// AutoGen v0.4 (actor model):
//   "Each agent maintains its own context. Pass only relevant
//    excerpts to other agents — not the full conversation."
//
// Google ADK:
//   "Use a sliding window of recent messages. Compress old results."

const SUMMARIZER_PROMPT = `Summarize this conversation into a compact context block.
Keep: key decisions made, files created/modified, important findings, current state.
Discard: verbose tool outputs, repeated searches, intermediate steps.
Be concise — 3-5 bullet points max.
Respond in plain text, no headers.`;

/**
 * Compress conversation history when it gets too long.
 * Keeps last N messages fresh, summarizes the rest.
 *
 * @param {Array}  messages     - Full conversation history
 * @param {object} opts
 * @returns {Array}             - Compressed messages
 */
export async function compressHistory(messages, opts = {}) {
  const {
    maxMessages   = 20,    // Start compressing above this
    keepRecent    = 6,     // Always keep last N messages fresh
    model,
    callOllamaFn,
  } = opts;

  if (messages.length <= maxMessages) return messages;

  // Split: old messages to summarize, recent to keep
  const toSummarize = messages.slice(0, messages.length - keepRecent);
  const recent      = messages.slice(-keepRecent);

  // Build summary of old messages
  const historyText = toSummarize
    .map(m => `${m.role.toUpperCase()}: ${String(m.content).slice(0, 300)}`)
    .join("\n");

  let summaryText = "[Previous context summarized]";
  if (callOllamaFn && model) {
    try {
      const resp = await callOllamaFn(model, [
        { role: "system", content: SUMMARIZER_PROMPT },
        { role: "user",   content: historyText },
      ]);
      summaryText = resp.message?.content || summaryText;
    } catch {}
  }

  // Replace old messages with a single summary message
  return [
    { role: "system", content: `[Conversation summary]\n${summaryText}` },
    ...recent,
  ];
}

/**
 * Extract only relevant context for a sub-agent.
 * AutoGen pattern: pass excerpts, not full history.
 *
 * @param {Array}  history - Full conversation
 * @param {string} topic   - What the sub-agent needs
 * @param {number} maxChars
 * @returns {string}
 */
export function extractRelevantContext(history, topic, maxChars = 1500) {
  const keywords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  // Score each message by keyword overlap
  const scored = history.map(m => {
    const text    = String(m.content).toLowerCase();
    const matches = keywords.filter(k => text.includes(k)).length;
    return { msg: m, score: matches };
  });

  // Sort by relevance, take top messages
  const relevant = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(s => `${s.msg.role.toUpperCase()}: ${String(s.msg.content).slice(0, 300)}`);

  const full = relevant.join("\n");
  return full.slice(0, maxChars);
}

/**
 * Sliding window — keep only the last N turns.
 * Simple but effective for most use cases.
 */
export function slidingWindow(messages, windowSize = 10) {
  if (messages.length <= windowSize) return messages;

  // Always keep system message if present
  const system = messages.filter(m => m.role === "system");
  const rest   = messages.filter(m => m.role !== "system");

  return [...system, ...rest.slice(-windowSize)];
}

/**
 * Estimate token count (rough: 4 chars = 1 token).
 */
export function estimateTokens(messages) {
  const chars = messages.reduce((sum, m) => sum + String(m.content || "").length, 0);
  return Math.round(chars / 4);
}