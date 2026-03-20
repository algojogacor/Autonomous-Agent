// tools/gui.js — GUI Automation (Windows 11 / WSL2 / Linux / macOS)
import { execSync } from "child_process";
import { preprocessScreenshot } from "../hardware/gpu.js";
import fs from "fs";
import path from "path";
import os from "os";

const PLATFORM = process.platform;

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", timeout: 15000, ...opts }).trim();
}

export const screenshotDef = {
  type: "function",
  function: {
    name: "take_screenshot",
    description: "Capture the current screen. GPU-compressed before Vision agent. Use before any GUI interaction.",
    parameters: { type: "object", properties: { save_path: { type: "string" }, preprocess: { type: "boolean" } }, required: [] },
  },
};

export async function takeScreenshot({ save_path, preprocess = true } = {}) {
  const rawPath = save_path || path.join(os.tmpdir(), `agent_screen_${Date.now()}.png`);
  try {
    if (PLATFORM === "win32") {
      const ep = rawPath.replace(/\\/g, "\\\\");
      const ps = [
        "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
        `$b=New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width,[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height)`,
        `$g=[System.Drawing.Graphics]::FromImage($b)`,
        `$g.CopyFromScreen([System.Drawing.Point]::Empty,[System.Drawing.Point]::Empty,$b.Size)`,
        `$b.Save('${ep}')`,
        `$g.Dispose();$b.Dispose()`,
      ].join("; ");
      run(`powershell -Command "${ps}"`);
    } else if (PLATFORM === "linux") {
      try { run(`scrot -o "${rawPath}"`); } catch { run(`import -window root "${rawPath}"`); }
    } else if (PLATFORM === "darwin") {
      run(`screencapture -x "${rawPath}"`);
    }
    if (!fs.existsSync(rawPath)) return { success: false, error: "Screenshot file not created" };
    if (preprocess) {
      const p = await preprocessScreenshot(rawPath);
      return { success: true, path: rawPath, ...p };
    }
    const buf = fs.readFileSync(rawPath);
    return { success: true, path: rawPath, base64: buf.toString("base64"), sizeKB: Math.round(buf.length / 1024) };
  } catch (e) { return { success: false, error: e.message }; }
}

export const mouseClickDef = {
  type: "function",
  function: {
    name: "mouse_click",
    description: "Click at (x,y). Use after take_screenshot + Vision analysis.",
    parameters: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, button: { type: "string", enum: ["left","right","double"] } }, required: ["x","y"] },
  },
};

export async function mouseClick({ x, y, button = "left" }) {
  try {
    if (PLATFORM === "win32") {
      const isRight = button === "right";
      const clicks  = button === "double" ? 2 : 1;
      const df = isRight ? "0x8"  : "0x2";
      const uf = isRight ? "0x10" : "0x4";
      const uid = Date.now();
      const ps = [
        "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
        `[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(${x},${y})`,
        "Start-Sleep -Milliseconds 100",
        `$sig='[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e);'`,
        `$m=Add-Type -MemberDefinition $sig -Name MC${uid} -Namespace W -PassThru`,
        `for($i=0;$i -lt ${clicks};$i++){$m::mouse_event(${df},0,0,0,0);Start-Sleep -Milliseconds 30;$m::mouse_event(${uf},0,0,0,0);Start-Sleep -Milliseconds 50}`,
      ].join("; ");
      run(`powershell -Command "${ps}"`);
    } else if (PLATFORM === "linux") {
      if (button === "double") run(`xdotool mousemove ${x} ${y} click --repeat 2 1`);
      else run(`xdotool mousemove ${x} ${y} click ${button === "right" ? 3 : 1}`);
    } else if (PLATFORM === "darwin") {
      run(`cliclick ${button === "double" ? "dc" : button === "right" ? "rc" : "c"}:${x},${y}`);
    }
    return { success: true, x, y, button };
  } catch (e) { return { success: false, error: e.message }; }
}

export const mouseMoveDef = {
  type: "function",
  function: {
    name: "mouse_move",
    description: "Move mouse to (x,y) without clicking.",
    parameters: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x","y"] },
  },
};

export async function mouseMove({ x, y }) {
  try {
    if (PLATFORM === "win32") {
      run(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(${x},${y})"`);
    } else if (PLATFORM === "linux") {
      run(`xdotool mousemove ${x} ${y}`);
    } else if (PLATFORM === "darwin") {
      run(`cliclick m:${x},${y}`);
    }
    return { success: true, x, y };
  } catch (e) { return { success: false, error: e.message }; }
}

export const keyboardDef = {
  type: "function",
  function: {
    name: "keyboard_type",
    description: "Type text or press shortcuts like 'ctrl+c', 'alt+F4', 'Return'.",
    parameters: { type: "object", properties: { text: { type: "string" }, shortcut: { type: "string" } }, required: [] },
  },
};

export async function keyboardType({ text, shortcut }) {
  try {
    if (PLATFORM === "win32") {
      if (text) {
        const safe = text.replace(/'/g, "''").replace(/[+^%~(){}]/g, '{$&}');
        run(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${safe}')"`);
      }
      if (shortcut) {
        const mapped = shortcut
          .replace(/ctrl\+/gi, "^").replace(/alt\+/gi, "%").replace(/shift\+/gi, "+")
          .replace(/Return|Enter/i, "{ENTER}").replace(/Escape|Esc/i, "{ESC}")
          .replace(/Tab/i, "{TAB}").replace(/Delete|Del/i, "{DELETE}").replace(/BackSpace/i, "{BACKSPACE}");
        run(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${mapped}')"`);
      }
    } else if (PLATFORM === "linux") {
      if (text)     run(`xdotool type --clearmodifiers "${text.replace(/"/g, '\\"')}"`);
      if (shortcut) run(`xdotool key "${shortcut}"`);
    } else if (PLATFORM === "darwin") {
      if (text)     run(`osascript -e 'tell application "System Events" to keystroke "${text.replace(/"/g, '\\"')}"'`);
      if (shortcut) run(`osascript -e 'tell application "System Events" to key code "${shortcut}"'`);
    }
    return { success: true, text, shortcut };
  } catch (e) { return { success: false, error: e.message }; }
}

export const scrollDef = {
  type: "function",
  function: {
    name: "mouse_scroll",
    description: "Scroll mouse wheel. direction: 'up'|'down'.",
    parameters: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, direction: { type: "string", enum: ["up","down"] }, amount: { type: "number" } }, required: ["direction"] },
  },
};

export async function mouseScroll({ x = 0, y = 0, direction = "down", amount = 3 }) {
  try {
    if (PLATFORM === "linux") {
      const btn = direction === "down" ? 5 : 4;
      for (let i = 0; i < amount; i++) run(`xdotool click ${btn}`);
    } else if (PLATFORM === "win32") {
      const delta = direction === "down" ? -120 * amount : 120 * amount;
      const uid = Date.now();
      const ps = [
        "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
        `[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(${x},${y})`,
        `$sig='[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e);'`,
        `$m=Add-Type -MemberDefinition $sig -Name MS${uid} -Namespace W -PassThru`,
        `$m::mouse_event(0x800,0,0,${delta},0)`,
      ].join("; ");
      run(`powershell -Command "${ps}"`);
    }
    return { success: true, direction, amount };
  } catch (e) { return { success: false, error: e.message }; }
}