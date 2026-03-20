// agents/performance.js — ⚡ Performance Audit Agent
import { MODELS }       from "../config.js";
import { TOOLS_CORE }   from "../tools/index.js";
import { runReActLoop } from "../core/react_loop.js";

const PERF_PROMPT = `You are a Senior Performance Engineer specializing in Node.js and system optimization.

## Your Scope
- CPU profiling: identify hot functions, blocking I/O, sync operations in async context
- Memory leaks: unclosed connections, unbounded caches, event listener leaks
- Database query optimization: N+1 queries, missing indexes, large result sets
- Network: unnecessary API calls, large payloads, missing compression
- Frontend: bundle size, render-blocking, unoptimized images
- Resource usage: high RAM, CPU spikes, disk I/O bottlenecks

## Output Format
For each finding:
{ "impact": "high|medium|low", "type": "cpu|memory|network|db|...", "location": "file:line", "current": "what's slow", "fix": "specific optimization", "estimatedGain": "~X% faster" }

Always suggest concrete, implementable fixes.`;

export async function analyze({ task, codeOrPath = "", rl, C, log }) {
  log(`\n  ⚡ [Performance Agent]`, C.yellow, task.slice(0, 80));
  return runReActLoop({
    model:        MODELS.coder,
    systemPrompt: PERF_PROMPT,
    task:         codeOrPath ? `Profile this:\n${codeOrPath}\n\nFocus: ${task}` : task,
    tools:        TOOLS_CORE,
    rl,
    label:        "Performance",
    C,
    log,
  });
}
