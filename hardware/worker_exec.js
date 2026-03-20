// hardware/worker_exec.js — Worker Thread: Bash Executor
// Runs in a separate thread from the main process.
// This file is spawned by threads.js — do not import directly.
import { workerData, parentPort } from "worker_threads";
import { execSync } from "child_process";

const { command, cwd } = workerData;

try {
  const stdout = execSync(command, {
    cwd,
    encoding:  "utf8",
    timeout:   60000,
    maxBuffer: 10 * 1024 * 1024,
  });
  parentPort.postMessage({ stdout, stderr: "", exit_code: 0 });
} catch (e) {
  parentPort.postMessage({
    stdout:    e.stdout || "",
    stderr:    e.stderr || e.message,
    exit_code: e.status || 1,
  });
}
