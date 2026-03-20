// agents/vision.js — 👁 Vision Agent (qwen3-vl:235b-cloud)
// Uses local RTX 3050 to preprocess screenshots before cloud analysis.
// Visual cache prevents redundant API calls for unchanged screens.
import { MODELS }                      from "../config.js";
import { TOOLS_GUI }                   from "../tools/index.js";
import { runReActLoop }                from "../core/react_loop.js";
import { preprocessScreenshot, localOCR } from "../hardware/gpu.js";
import { checkVisualCache, remember }  from "../memory/vectorstore.js";
import crypto                          from "crypto";
import fs                              from "fs";

const SYSTEM_PROMPT = `You are the Vision & UI Perception agent — the eyes of an autonomous AI system.

## Your Role
Analyze screenshots and describe what you see with extreme precision.

## Responsibilities
- Identify ALL visible GUI elements: buttons, input fields, menus, icons, text, error boxes.
- Return EXACT pixel coordinates (x, y) for clickable elements.
- Read ALL text on screen (error messages, labels, terminal output, window titles).
- Describe the current UI state: loading, idle, error, popup, etc.
- If multiple elements match a description, list ALL of them with coordinates.

## Coordinate Format
Always return coordinates as: { "element": "label", "x": 450, "y": 230, "confidence": "high" }

## Important
Be precise. Wrong coordinates cause the agent to click the wrong thing.
If the screen is unclear or blurry, say so explicitly.`;

/**
 * Analyze a screenshot with GPU preprocessing + optional OCR shortcut.
 */
export async function analyze({ task, screenshotPath, context = "", rl, C, log }) {
  log(`\n  👁 [Vision]`, C.magenta, task.slice(0, 80));

  let base64 = null;
  let ocrText = "";
  let cacheHit = false;

  // GPU preprocessing if screenshot available
  if (screenshotPath && fs.existsSync(screenshotPath)) {
    // Hash for visual cache
    const rawBuf = fs.readFileSync(screenshotPath);
    const hash   = crypto.createHash("md5").update(rawBuf).digest("hex");

    // Check visual cache (skip cloud call if screen unchanged < 10s)
    const cached = await checkVisualCache(hash);
    if (cached) {
      log(`  👁 Visual cache HIT — skipping cloud call`, C.green);
      return cached.text;
    }

    // Local OCR first (fast, RTX 3050, no cloud cost)
    if (task.includes("text") || task.includes("read") || task.includes("error")) {
      const ocr = await localOCR(screenshotPath);
      if (ocr.confidence > 60 && ocr.text.length > 10) {
        log(`  👁 Local OCR (${ocr.confidence}%): "${ocr.text.slice(0, 80)}"`, C.gray);
        ocrText = `[Local OCR Result]\n${ocr.text}\n\n`;
      }
    }

    // GPU preprocess: resize 1024px, compress JPEG
    const processed = await preprocessScreenshot(screenshotPath);
    base64 = processed.base64;
    log(`  👁 GPU compressed: ${processed.rawSizeKB}KB → ${processed.sizeKB}KB (${processed.savings} saved)`, C.gray);

    // Save to visual cache
    await remember(`Screen analysis: ${task}`, {
      type: "visual",
      hash,
      task,
    });
  }

  const userMessage = [
    ocrText,
    context ? `Context: ${context}\n\n` : "",
    task,
    base64 ? `\n\n[Screenshot attached as base64 JPEG]` : "\n\nNo screenshot provided — use take_screenshot first.",
  ].join("");

  return runReActLoop({
    model:        MODELS.vision,
    systemPrompt: SYSTEM_PROMPT,
    task:         userMessage,
    tools:        TOOLS_GUI,
    rl,
    label:        "Vision",
    C,
    log,
  });
}
