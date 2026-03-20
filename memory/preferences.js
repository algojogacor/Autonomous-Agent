// memory/preferences.js — User Preference Learning & Alignment
// Logs every human correction and builds a "personality" for the agent.
// Over time the agent will match your exact coding style and workflow.
import fs   from "fs";
import path from "path";
import { WORKING_DIR } from "../config.js";

const PREFS_FILE = path.join(WORKING_DIR, ".agent_preferences.json");

// Default preferences (updated as user corrects the agent)
let prefs = {
  // Technical choices
  packageManager:  "npm",         // npm | yarn | pnpm
  language:        "javascript",  // primary language
  framework:       null,          // express | fastify | etc
  testFramework:   null,
  styleGuide:      "standard",    // standard | airbnb | google

  // Behaviour
  verbosity:       "concise",     // verbose | concise | minimal
  askBeforeDelete: true,
  preferredShell:  "powershell",  // powershell | cmd | wsl

  // Corrections log: [{timestamp, original, correction, category}]
  corrections:     [],

  // Explicit preferences learned from corrections
  learned:         {},
};

function load() {
  try {
    const stored = JSON.parse(fs.readFileSync(PREFS_FILE, "utf8"));
    prefs = { ...prefs, ...stored };
  } catch {}
}

function save() {
  try { fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), "utf8"); }
  catch {}
}

load();

/**
 * Log a human correction. Automatically updates learned preferences.
 * @param {string} category - "library"|"style"|"behaviour"|"tool"
 * @param {string} original - what the agent did
 * @param {string} correction - what the user wanted instead
 */
export function logCorrection(category, original, correction) {
  prefs.corrections.push({
    timestamp:  new Date().toISOString(),
    category,
    original,
    correction,
  });

  // Auto-learn from common correction patterns
  const lower = correction.toLowerCase();

  if (category === "library") {
    const match = lower.match(/use\s+(\S+)\s+(?:instead|over|not)\s+(\S+)/);
    if (match) {
      prefs.learned[`prefer_over_${match[2]}`] = match[1];
    }
  }

  if (category === "behaviour" && lower.includes("don't ask")) {
    prefs.askBeforeDelete = false;
  }

  if (category === "style" && lower.includes("yarn")) {
    prefs.packageManager = "yarn";
  }

  save();
}

/**
 * Set a specific preference directly.
 */
export function set(key, value) {
  prefs[key] = value;
  save();
}

/**
 * Get the full preferences context string to inject into system prompts.
 */
export function getContextString() {
  const learned  = Object.entries(prefs.learned).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  const recentFixes = prefs.corrections
    .slice(-5)
    .map(c => `- [${c.category}] Instead of "${c.original}", user prefers "${c.correction}"`)
    .join("\n");

  return `## User Preferences
- Package manager: ${prefs.packageManager}
- Primary language: ${prefs.language}
- Shell: ${prefs.preferredShell}
- Verbosity: ${prefs.verbosity}
${learned ? `\nLearned preferences:\n${learned}` : ""}
${recentFixes ? `\nRecent corrections:\n${recentFixes}` : ""}`.trim();
}

export function get(key) { return prefs[key]; }
export function all()    { return { ...prefs }; }
export function stats()  {
  return { corrections: prefs.corrections.length, learned: Object.keys(prefs.learned).length };
}
