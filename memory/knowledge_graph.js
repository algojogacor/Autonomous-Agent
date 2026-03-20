// memory/knowledge_graph.js — Personal Knowledge Graph
// Maps project-specific relationships: libraries, patterns, conventions.
// e.g. "Baileys requires auth_state" | "User prefers Express over Fastify"
// Persisted to .agent_knowledge.json — grows over time.
import fs   from "fs";
import path from "path";
import { WORKING_DIR } from "../config.js";

const GRAPH_FILE = path.join(WORKING_DIR, ".agent_knowledge.json");

// ── Graph Structure ──────────────────────────────────
// { nodes: { id: { id, label, type, props } }, edges: [ { from, to, relation, weight } ] }

let graph = { nodes: {}, edges: [] };

function load() {
  try { graph = JSON.parse(fs.readFileSync(GRAPH_FILE, "utf8")); }
  catch { graph = { nodes: {}, edges: [] }; }
}

function save() {
  try { fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph, null, 2), "utf8"); }
  catch {}
}

load();

// ── Node Types ───────────────────────────────────────
// library, project, convention, error, solution, preference, person

function nodeId(label) {
  return label.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

export function addNode(label, type = "general", props = {}) {
  const id = nodeId(label);
  if (!graph.nodes[id]) {
    graph.nodes[id] = { id, label, type, props, createdAt: Date.now() };
  } else {
    Object.assign(graph.nodes[id].props, props);
  }
  save();
  return id;
}

export function addEdge(fromLabel, relation, toLabel, weight = 1.0) {
  const fromId = addNode(fromLabel);
  const toId   = addNode(toLabel);
  // Avoid duplicate edges
  const exists = graph.edges.find(
    e => e.from === fromId && e.to === toId && e.relation === relation
  );
  if (!exists) {
    graph.edges.push({ from: fromId, to: toId, relation, weight, createdAt: Date.now() });
    save();
  }
}

/**
 * Learn a fact: subject —[verb]→ object
 * e.g. learn("Baileys", "requires", "auth_state")
 *      learn("User", "prefers", "Express over Fastify")
 */
export function learn(subject, verb, object, context = "") {
  const sid = addNode(subject, "entity");
  const oid = addNode(object,  "fact");
  addEdge(subject, verb, object);
  if (context) graph.nodes[oid].props.context = context;
  save();
}

/**
 * Query: what do we know about a topic?
 */
export function query(topic) {
  const id  = nodeId(topic);
  const node = graph.nodes[id];
  if (!node) return null;

  const outgoing = graph.edges
    .filter(e => e.from === id)
    .map(e => ({ relation: e.relation, target: graph.nodes[e.to]?.label, weight: e.weight }));

  const incoming = graph.edges
    .filter(e => e.to === id)
    .map(e => ({ relation: e.relation, source: graph.nodes[e.from]?.label, weight: e.weight }));

  return { node, outgoing, incoming };
}

/**
 * Find relevant knowledge for a query string.
 * Returns a formatted string of facts.
 */
export function getRelevantFacts(queryStr) {
  const words = queryStr.toLowerCase().split(/\s+/);
  const matched = new Set();

  for (const word of words) {
    for (const [id, node] of Object.entries(graph.nodes)) {
      if (id.includes(word) || node.label.toLowerCase().includes(word)) {
        matched.add(id);
      }
    }
  }

  if (matched.size === 0) return "";

  const facts = [];
  for (const id of matched) {
    const out = graph.edges
      .filter(e => e.from === id)
      .map(e => `${graph.nodes[id].label} ${e.relation} ${graph.nodes[e.to]?.label || e.to}`);
    facts.push(...out);
  }

  return facts.length ? `[Knowledge Base]\n${facts.join("\n")}\n` : "";
}

export function stats() {
  return {
    nodes: Object.keys(graph.nodes).length,
    edges: graph.edges.length,
    types: [...new Set(Object.values(graph.nodes).map(n => n.type))],
  };
}

export function clearAll() {
  graph = { nodes: {}, edges: [] };
  try { fs.unlinkSync(GRAPH_FILE); } catch {}
}
