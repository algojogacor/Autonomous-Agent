// hardware/threads.js — i7-13th Gen Worker Thread Pool
// Utilizes P-cores for parallel bash/file operations.
// Allows the LLM to keep thinking while background tasks execute.
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { HARDWARE, WORKING_DIR } from "../config.js";

const MAX_WORKERS = HARDWARE.cpu.workerThreads; // 6 P-cores

// ── Simple Task Queue ────────────────────────────────
class ThreadPool {
  constructor(size) {
    this.size    = size;
    this.queue   = [];
    this.active  = 0;
    this.results = new Map();
  }

  /**
   * Submit a bash command to run in parallel.
   * Returns a Promise that resolves with { stdout, stderr, exit_code }.
   */
  run({ command, cwd, taskId }) {
    return new Promise((resolve, reject) => {
      const task = { command, cwd: cwd || WORKING_DIR, taskId, resolve, reject };
      if (this.active < this.size) {
        this._execute(task);
      } else {
        this.queue.push(task);
      }
    });
  }

  _execute(task) {
    this.active++;
    // Run in a Worker thread so main thread stays free for LLM calls
    const worker = new Worker(
      new URL("./worker_exec.js", import.meta.url),
      { workerData: { command: task.command, cwd: task.cwd } }
    );

    worker.on("message", (result) => {
      task.resolve(result);
      this.active--;
      if (this.queue.length > 0) this._execute(this.queue.shift());
    });

    worker.on("error", (err) => {
      task.resolve({ stdout: "", stderr: err.message, exit_code: 1 });
      this.active--;
      if (this.queue.length > 0) this._execute(this.queue.shift());
    });
  }
}

// Singleton pool
let pool;
export function getPool() {
  if (!pool) pool = new ThreadPool(MAX_WORKERS);
  return pool;
}

/**
 * Run multiple bash commands in PARALLEL using P-cores.
 * Returns all results when ALL commands finish.
 *
 * @param {Array<{command: string, cwd?: string}>} commands
 * @returns {Promise<Array<{stdout, stderr, exit_code}>>}
 */
export async function runParallel(commands) {
  const p = getPool();
  return Promise.all(
    commands.map((cmd, i) => p.run({ ...cmd, taskId: `task_${i}_${Date.now()}` }))
  );
}

/**
 * Run a single command in a worker thread (non-blocking).
 */
export async function runThreaded(command, cwd) {
  return getPool().run({ command, cwd });
}

export const poolStatus = () => ({
  maxWorkers: MAX_WORKERS,
  active:     pool?.active || 0,
  queued:     pool?.queue?.length || 0,
});
