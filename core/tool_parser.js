// core/tool_parser.js — Text-based tool call parser
//
// Handles ALL formats Ollama models use when they don't return tool_calls JSON:
//
// Format A (most common — bare name + JSON):
//   web_search
//   { "query": "..." }
//
// Format B (with ACTION prefix):
//   ACTION: web_search
//   { "query": "..." }
//
// Format C (with code fence):
//   web_search
//   ```json
//   { "query": "..." }
//   ```
//
// Format D (inline call):
//   web_search({"query": "..."})

const TOOL_NAMES = [
  "execute_bash","execute_bash_parallel","read_file","write_file","patch_file",
  "list_directory","web_search","fetch_url","call_api",
  "take_screenshot","mouse_click","mouse_move","mouse_scroll","keyboard_type",
  "save_progress","recall_memory","learn_fact","query_knowledge",
  "delegate_vision","delegate_coder","delegate_logic",
  "delegate_security","delegate_performance","audit_plan","ask_user",
];

// Build one big regex: matches any tool name as a standalone token
const TOOL_PATTERN = new RegExp(
  '(?:ACTION:\\s*)?(' + TOOL_NAMES.join('|') + ')' +
  '(?:\\s*\\(\\s*)?\\s*(?:```(?:json)?\\s*)?([\\s\\S]*?)(?:```\\s*)?(?=(?:ACTION:\\s*)?(?:' +
  TOOL_NAMES.join('|') + ')|$)',
  'gi'
);

export function parseTextToolCalls(text) {
  if (!text) return [];
  const calls = [];
  const seen  = new Set();

  // Format D first: tool_name({...})
  for (const name of TOOL_NAMES) {
    const re = new RegExp(name + '\\s*\\(\\s*(\\{[\\s\\S]*?\\})\\s*\\)', 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      const key = name + ':' + m[1];
      if (seen.has(key)) continue;
      seen.add(key);
      let args = {};
      try { args = JSON.parse(m[1]); } catch {}
      calls.push(makeCall(name, args));
    }
  }
  if (calls.length) return calls;

  // Formats A/B/C: tool_name (optionally with ACTION:) followed by JSON block
  for (const name of TOOL_NAMES) {
    // Match: (ACTION:\s*)? + tool_name + whitespace + optional ``` + JSON block
    const re = new RegExp(
      '(?:ACTION:\\s*)?' + name + '\\s*\\n\\s*(?:```(?:json)?\\s*\\n?)?' +
      '(\\{[\\s\\S]*?\\})' +
      '(?:\\s*\\n?```)?',
      'gi'
    );
    let m;
    while ((m = re.exec(text)) !== null) {
      const key = name + ':' + m[1];
      if (seen.has(key)) continue;
      seen.add(key);
      let args = {};
      try { args = JSON.parse(m[1]); } catch {}
      calls.push(makeCall(name, args));
    }
  }
  if (calls.length) return calls;

  // Last resort: tool name on its own line, next non-empty content is JSON
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().replace(/^ACTION:\s*/i, '').replace(/^\*+|\*+$/g, '').trim();
    if (!TOOL_NAMES.includes(line)) continue;
    const name = line;

    // Collect lines after until we find a complete JSON block
    let jsonStr = '';
    let depth   = 0;
    let started = false;
    for (let j = i + 1; j < lines.length && j < i + 20; j++) {
      const l = lines[j];
      for (const ch of l) {
        if (ch === '{') { depth++; started = true; }
        if (ch === '}') depth--;
      }
      if (started) jsonStr += l + '\n';
      if (started && depth === 0) break;
    }

    const key = name + ':' + jsonStr;
    if (seen.has(key)) continue;
    seen.add(key);

    let args = {};
    if (jsonStr.trim()) {
      try { args = JSON.parse(jsonStr.trim()); } catch {}
    }
    calls.push(makeCall(name, args));
  }

  return calls;
}

function makeCall(name, args) {
  return {
    id:       'ptc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    function: { name, arguments: args },
  };
}