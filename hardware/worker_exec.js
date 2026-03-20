// hardware/worker_exec.js — Worker Thread: Bash Executor
import { workerData, parentPort } from "worker_threads";
import { execSync } from "child_process";

const { command, cwd } = workerData;

// On Windows, wrap with powershell so all PS commands work correctly
const isWin = process.platform === "win32";

try {
  const stdout = execSync(command, {
    cwd,
    encoding:  "utf8",
    timeout:   60000,
    maxBuffer: 10 * 1024 * 1024,
    shell:     isWin ? "powershell.exe" : "/bin/bash",
    windowsHide: true,
  });
  parentPort.postMessage({ stdout: stdout || "", stderr: "", exit_code: 0 });
} catch (e) {
  parentPort.postMessage({
    stdout:    e.stdout || "",
    stderr:    e.stderr || e.message,
    exit_code: e.status || 1,
  });
}