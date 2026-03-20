// tools/gui.js — GUI Automation (Windows 11 / WSL2 / Linux / macOS)
// Screenshot → GPU preprocess → Vision agent → Click/Type
import { execSync }            from "child_process";
import { preprocessScreenshot } from "../hardware/gpu.js";
import fs   from "fs";
import path from "path";
import os   from "os";

const PLATFORM = process.platform;

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", timeout: 15000, ...opts }).trim();
}

// ── Screenshot ───────────────────────────────────────
export const screenshotDef = {
  type: "function",
  function: {
    name: "take_screenshot",
    description:
      "Capture the current screen. The image is GPU-compressed (RTX 3050) before being sent to the Vision agent. Use before any GUI interaction.",
    parameters: {
      type: "object",
      properties: {
        save_path:  { type: "string",  description: "Output path (default: system temp)" },
        preprocess: { type: "boolean", description: "GPU-compress the screenshot (default: true)" },
      },
      required: [],
    },
  },
};

export async function takeScreenshot({ save_path, preprocess = true } = {}) {
  const rawPath = save_path || path.join(os.tmpdir(), `agent_screen_${Date.now()}.png`);

  try {
    if (PLATFORM === "win32") {
      // Windows 11 — PowerShell screen capture
      const ps = `
$bmp = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height)
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen([System.Drawing.Point]::Empty, [System.Drawing.Point]::Empty, $bmp.Size)
$bmp.Save('${rawPath.replace(/\\/g, "\\\\")}')
$g.Dispose(); $bmp.Dispose()
`.trim();
      run(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ${ps}"`);
    } else if (PLATFORM === "linux") {
      // WSL2 or native Linux
      try { run(`scrot -o "${rawPath}"`); }
      catch { run(`import -window root "${rawPath}"`); }
    } else if (PLATFORM === "darwin") {
      run(`screencapture -x "${rawPath}"`);
    }

    if (!fs.existsSync(rawPath)) {
      return { success: false, error: "Screenshot file not created" };
    }

    // GPU preprocess (RTX 3050 via sharp/libvips)
    if (preprocess) {
      const processed = await preprocessScreenshot(rawPath);
      return {
        success:   true,
        path:      rawPath,
        base64:    processed.base64,
        width:     processed.width,
        height:    processed.height,
        sizeKB:    processed.sizeKB,
        rawSizeKB: processed.rawSizeKB,
        savings:   processed.savings,
        method:    processed.method,
      };
    }

    const buf = fs.readFileSync(rawPath);
    return { success: true, path: rawPath, base64: buf.toString("base64"), sizeKB: Math.round(buf.length / 1024) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Mouse Click ──────────────────────────────────────
export const mouseClickDef = {
  type: "function",
  function: {
    name: "mouse_click",
    description:
      "Move the mouse to (x, y) and click. Use AFTER take_screenshot + Vision analysis to get correct coordinates.",
    parameters: {
      type: "object",
      properties: {
        x:      { type: "number" },
        y:      { type: "number" },
        button: { type: "string", enum: ["left","right","double"], description: "default: left" },
      },
      required: ["x", "y"],
    },
  },
};

export async function mouseClick({ x, y, button = "left" }) {
  try {
    if (PLATFORM === "win32") {
      const clicks = button === "double" ? 2 : 1;
      const btn    = button === "right"  ? 2 : 1;
      const ps = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
Start-Sleep -Milliseconds 100
$sig = '[DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);'
$m   = Add-Type -MemberDefinition $sig -Name Mouse -PassThru
for ($i=0; $i -lt ${clicks}; $i++) { $m::mouse_event(${btn === 1 ? "0x2|0x4" : "0x8|0x10"}, 0, 0, 0, 0); Start-Sleep -Milliseconds 50 }
`.trim();
      run(`powershell -Command "${ps}"`);
    } else if (PLATFORM === "linux") {
      if (button === "double") run(`xdotool mousemove ${x} ${y} click --repeat 2 1`);
      else run(`xdotool mousemove ${x} ${y} click ${button === "right" ? 3 : 1}`);
    } else if (PLATFORM === "darwin") {
      run(`cliclick ${button === "double" ? "dc" : button === "right" ? "rc" : "c"}:${x},${y}`);
    }
    return { success: true, x, y, button };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Mouse Move (no click) ────────────────────────────
export const mouseMoveDef = {
  type: "function",
  function: {
    name: "mouse_move",
    description: "Move the mouse to (x, y) without clicking. Useful for hovering.",
    parameters: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
      },
      required: ["x", "y"],
    },
  },
};

export async function mouseMove({ x, y }) {
  try {
    if (PLATFORM === "win32") {
      run(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})"`);
    } else if (PLATFORM === "linux") {
      run(`xdotool mousemove ${x} ${y}`);
    } else if (PLATFORM === "darwin") {
      run(`cliclick m:${x},${y}`);
    }
    return { success: true, x, y };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Keyboard ─────────────────────────────────────────
export const keyboardDef = {
  type: "function",
  function: {
    name: "keyboard_type",
    description:
      "Type text or press keyboard shortcuts. Examples: type 'Hello World', shortcut 'ctrl+c', 'alt+F4', 'Return', 'ctrl+shift+t'.",
    parameters: {
      type: "object",
      properties: {
        text:     { type: "string", description: "Text to type" },
        shortcut: { type: "string", description: "Keyboard shortcut, e.g. 'ctrl+c', 'Return'" },
      },
      required: [],
    },
  },
};

export async function keyboardType({ text, shortcut }) {
  try {
    if (PLATFORM === "win32") {
      if (text) {
        run(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''").replace(/[+^%~(){}]/g, "{$&}"}')"`);
      }
      if (shortcut) {
        // Convert ctrl+c → ^c, alt+F4 → %{F4}, shift+a → +a
        const mapped = shortcut
          .replace(/ctrl\+/gi, "^")
          .replace(/alt\+/gi,  "%")
          .replace(/shift\+/gi, "+")
          .replace(/Return|Enter/i, "{ENTER}")
          .replace(/Escape|Esc/i, "{ESC}")
          .replace(/Tab/i, "{TAB}")
          .replace(/Delete|Del/i, "{DELETE}")
          .replace(/BackSpace/i, "{BACKSPACE}");
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
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Scroll ───────────────────────────────────────────
export const scrollDef = {
  type: "function",
  function: {
    name: "mouse_scroll",
    description: "Scroll the mouse wheel at a position. direction: 'up'|'down', amount: lines.",
    parameters: {
      type: "object",
      properties: {
        x:         { type: "number" },
        y:         { type: "number" },
        direction: { type: "string", enum: ["up","down"] },
        amount:    { type: "number", description: "Lines to scroll (default 3)" },
      },
      required: ["direction"],
    },
  },
};

export async function mouseScroll({ x = 0, y = 0, direction = "down", amount = 3 }) {
  try {
    if (PLATFORM === "linux") {
      const btn = direction === "down" ? 5 : 4;
      for (let i = 0; i < amount; i++) run(`xdotool click ${btn}`);
    } else if (PLATFORM === "win32") {
      const delta = direction === "down" ? -120 * amount : 120 * amount;
      run(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x},${y}); [System.Windows.Forms.Application]::DoEvents()"`);
    }
    return { success: true, direction, amount };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
