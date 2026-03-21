// core/guardrails.js
// ═══════════════════════════════════════════════════════════════
// PATTERN: Guardrails (Input + Output Validation)
// Sumber: OpenAI Agents SDK + Anthropic production guide
// ═══════════════════════════════════════════════════════════════
//
// OpenAI Agents SDK (2025):
//   "Guardrails run in parallel with your agent. Input guardrails check
//    incoming requests. Output guardrails validate responses before delivery.
//    Tripwire: if guardrail fails, raise an exception immediately."
//
// Anthropic:
//   "Implement permission systems that prevent agents from taking actions
//    beyond what is needed for the current task."

// ── Input Guardrails ──────────────────────────────────────────
const DANGEROUS_INPUT_PATTERNS = [
  // Data destruction
  { pattern: /\b(hapus|delete|remove|destroy)\s+.*(semua|all|everything|seluruh)/i,
    risk: "mass-delete", msg: "Perintah hapus massal terdeteksi" },
  // Credential exposure
  { pattern: /kirim.*(password|api.?key|token|credential|rahasia)/i,
    risk: "credential-leak", msg: "Perintah ekspos kredensial terdeteksi" },
  // System damage
  { pattern: /format\s+(disk|drive|harddisk|c:|d:|e:)/i,
    risk: "disk-format", msg: "Perintah format disk terdeteksi" },
  // Email spam
  { pattern: /kirim.*(email|pesan|message)\s+ke\s+(semua|all|everyone)/i,
    risk: "mass-email", msg: "Perintah kirim pesan massal terdeteksi" },
];

// ── Output Guardrails ─────────────────────────────────────────
const DANGEROUS_OUTPUT_PATTERNS = [
  // Never output real credentials
  { pattern: /(?:password|api_key|secret|token)\s*[:=]\s*["']?[a-zA-Z0-9+/]{20,}/i,
    risk: "credential-in-output" },
  // Never suggest rm -rf without context
  { pattern: /^rm\s+-rf\s+\/\s*$/m,
    risk: "root-delete" },
];

// ── PII Detector ──────────────────────────────────────────────
const PII_PATTERNS = [
  { name: "KTP",    pattern: /\b\d{16}\b/ },
  { name: "NPWP",   pattern: /\b\d{2}\.\d{3}\.\d{3}\.\d{1}-\d{3}\.\d{3}\b/ },
  { name: "Phone",  pattern: /\b(\+62|08)\d{8,12}\b/ },
  { name: "Email",  pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/ },
];

/**
 * Validate user input before sending to agent.
 * Returns { safe: bool, risk: string, message: string }
 */
export function validateInput(userMessage) {
  for (const guard of DANGEROUS_INPUT_PATTERNS) {
    if (guard.pattern.test(userMessage)) {
      return { safe: false, risk: guard.risk, message: guard.msg };
    }
  }
  return { safe: true };
}

/**
 * Validate agent output before showing to user.
 * Returns { safe: bool, risk: string, sanitized: string }
 */
export function validateOutput(output) {
  let sanitized = output;
  const risks   = [];

  for (const guard of DANGEROUS_OUTPUT_PATTERNS) {
    if (guard.pattern.test(output)) {
      risks.push(guard.risk);
      sanitized = sanitized.replace(guard.pattern, "[REDACTED]");
    }
  }

  return {
    safe:      risks.length === 0,
    risks,
    sanitized,
  };
}

/**
 * Detect PII in output (for privacy compliance).
 * Returns { hasPII: bool, types: string[] }
 */
export function detectPII(text) {
  const found = PII_PATTERNS
    .filter(p => p.pattern.test(text))
    .map(p => p.name);
  return { hasPII: found.length > 0, types: found };
}

/**
 * Token budget guardrail — prevent runaway context costs.
 * Rough estimate: 1 token ≈ 4 chars.
 */
export function checkTokenBudget(messages, maxTokens = 32000) {
  const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  const estimate   = Math.round(totalChars / 4);
  return {
    ok:          estimate < maxTokens,
    estimated:   estimate,
    max:         maxTokens,
    percentage:  Math.round(estimate / maxTokens * 100),
  };
}