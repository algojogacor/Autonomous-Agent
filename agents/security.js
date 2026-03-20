// agents/security.js — 🔒 Security Audit Agent
import { MODELS }       from "../config.js";
import { TOOLS_CORE }   from "../tools/index.js";
import { runReActLoop } from "../core/react_loop.js";

const SECURITY_PROMPT = `You are a Senior Application Security Engineer performing a security audit.

## Your Scope
- XSS (Cross-Site Scripting): reflected, stored, DOM-based
- SQL / NoSQL Injection
- Insecure dependencies (check package.json for known CVEs)
- Hardcoded secrets, API keys, passwords in code
- Authentication & authorization flaws (JWT, session, CORS)
- Path traversal, SSRF, RCE vulnerabilities
- OWASP Top 10 checklist

## Output Format
For each finding, output:
{ "severity": "critical|high|medium|low", "type": "XSS|SQLi|...", "location": "file:line", "description": "...", "fix": "..." }

Be specific. Reference exact line numbers when possible.`;

export async function audit({ task, codeOrPath = "", rl, C, log }) {
  log(`\n  🔒 [Security Agent]`, C.red, task.slice(0, 80));
  return runReActLoop({
    model:        MODELS.logic,   // Use DeepSeek for deep security reasoning
    systemPrompt: SECURITY_PROMPT,
    task:         codeOrPath ? `Audit this code/path:\n${codeOrPath}\n\nFocus: ${task}` : task,
    tools:        TOOLS_CORE,
    rl,
    label:        "Security",
    C,
    log,
  });
}
