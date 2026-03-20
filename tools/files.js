// tools/files.js — File System Tools
import fs   from "fs";
import path from "path";
import { WORKING_DIR } from "../config.js";
import { remember }    from "../memory/vectorstore.js";

export const readDef = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read the full text contents of any file from disk.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute or relative path" },
      },
      required: ["file_path"],
    },
  },
};

export async function readFile({ file_path }) {
  const fp = path.resolve(WORKING_DIR, file_path);
  const content = fs.readFileSync(fp, "utf8");
  return { content, chars: content.length, path: fp };
}

export const writeDef = {
  type: "function",
  function: {
    name: "write_file",
    description: "Create or overwrite a file with given text content. Creates parent dirs automatically.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        content:   { type: "string" },
      },
      required: ["file_path", "content"],
    },
  },
};

export async function writeFile({ file_path, content }) {
  const fp = path.resolve(WORKING_DIR, file_path);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, "utf8");
  await remember(`Created file: ${fp}`, { type: "task", tags: ["file-write"] });
  return { success: true, path: fp, bytes: Buffer.byteLength(content) };
}

export const patchDef = {
  type: "function",
  function: {
    name: "patch_file",
    description: "Find and replace a specific string in a file. Targeted edit without full rewrite.",
    parameters: {
      type: "object",
      properties: {
        file_path:      { type: "string" },
        search_string:  { type: "string" },
        replace_string: { type: "string" },
      },
      required: ["file_path", "search_string", "replace_string"],
    },
  },
};

export async function patchFile({ file_path, search_string, replace_string }) {
  const fp = path.resolve(WORKING_DIR, file_path);
  const content = fs.readFileSync(fp, "utf8");
  if (!content.includes(search_string)) {
    return { success: false, error: "search_string not found in file" };
  }
  fs.writeFileSync(fp, content.replace(search_string, replace_string), "utf8");
  return { success: true, path: fp };
}

export const listDef = {
  type: "function",
  function: {
    name: "list_directory",
    description: "List all files and folders in a directory.",
    parameters: {
      type: "object",
      properties: {
        dir_path: { type: "string" },
      },
      required: [],
    },
  },
};

export async function listDirectory({ dir_path } = {}) {
  const dp = path.resolve(WORKING_DIR, dir_path || ".");
  const entries = fs.readdirSync(dp, { withFileTypes: true });
  return {
    path:  dp,
    items: entries.map(e => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" })),
  };
}
