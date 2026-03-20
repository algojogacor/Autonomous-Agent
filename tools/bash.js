// tools/bash.js — Multi-threaded Bash (i7 P-core Optimized)
import { execSync }      from "child_process";
import { runParallel, runThreaded } from "../hardware/threads.js";
import { WORKING_DIR }  from "../config.js";

export const definition = {
  type: "function",
  function: {
    name: "execute_bash",
    description:
      "Run any shell command (PowerShell/WSL2/Bash). Use for: npm/pip install, running scripts, git, system info, file ops, network commands. Multi-threaded on i7 P-cores. For destructive commands (rm -rf, force push), use ask_user first.",
    parameters: {
      type: "object",
      properties: {
        command:   { type: "string",  description: "Shell command to execute" },
        cwd:       { type: "string",  description: "Working directory (optional)" },
        background:{ type: "boolean", description: "Run in background thread, non-blocking (optional)" },
      },
      required: ["command"],
    },
  },
};

export const parallelDef = {
  type: "function",
  function: {
    name: "execute_bash_parallel",
    description:
      "Run multiple independent shell commands SIMULTANEOUSLY using i7 P-cores. Faster than sequential. Use when commands don't depend on each other.",
    parameters: {
      type: "object",
      properties: {
        commands: {
          type: "array",
          items: {
            type: "object",
            properties: {
              command: { type: "string" },
              cwd:     { type: "string" },
              label:   { type: "string" },
            },
            required: ["command"],
          },
          description: "Array of independent commands to run in parallel",
        },
      },
      required: ["commands"],
    },
  },
};

export async function execute({ command, cwd, background = false }) {
  const dir = cwd || WORKING_DIR;

  if (background) {
    // Non-blocking — returns immediately with task ID
    const taskId = `bg_${Date.now()}`;
    runThreaded(command, dir).then(() => {}); // fire and forget
    return { taskId, status: "running_in_background", command };
  }

  // Threaded execution (keeps main thread free for LLM)
  return runThreaded(command, dir);
}

export async function executeParallel({ commands }) {
  const results = await runParallel(commands.map(c => ({
    command: c.command,
    cwd:     c.cwd || WORKING_DIR,
  })));
  return results.map((r, i) => ({
    label:  commands[i].label || `cmd_${i}`,
    ...r,
  }));
}
