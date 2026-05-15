// src/layout.ts — async layered layout via elkjs.
//
// Replaces the previous Dagre TB-only-place-edges pass. Goals (from the
// "composite explorer layout overhaul" design):
//   - Left-right flow (matches input-port-on-left, output-port-on-right).
//   - Cluster: child stores + their processes nest under their parent store
//     in the ELK compound graph, so related nodes lay out close together
//     instead of stretching into one long line.
//   - Wire edges contribute to layout (informs ranking + crossing
//     minimization), unlike the prior code which used place edges only.
//
// The layout function is async (ELK's API). Callers that want the
// non-async "use whatever positions are already there" simple fallback
// can use `applyCompactLayout` synchronously.

import ELK from "elkjs/lib/elk.bundled.js";
import type { Node, Edge } from "@xyflow/react";

const elk = new ELK();

/** Elk options applied at every level (top-level + every compound). */
const LAYOUT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.spacing.nodeNodeBetweenLayers": "80",
  "elk.spacing.nodeNode": "50",
  "elk.padding": "[top=24,left=24,bottom=24,right=24]",
};

/** Default measured size used before React Flow has measured the real node. */
function nodeSize(n: Node): { width: number; height: number } {
  if (n.type === "process") return { width: 140, height: 60 };
  return { width: 80, height: 60 };  // store (circle, bbox-ish)
}

/** A node's store-parent path = its path with the last segment dropped. */
function parentPathKey(n: Node): string | null {
  const path: unknown = (n.data as { path?: unknown })?.path;
  if (!Array.isArray(path) || path.length <= 1) return null;
  return (path as string[]).slice(0, -1).join(".");
}

/** A node's own id-as-path key (matches the convention in `convert.ts`). */
function selfPathKey(n: Node): string | null {
  const path: unknown = (n.data as { path?: unknown })?.path;
  if (!Array.isArray(path) || path.length === 0) return null;
  return (path as string[]).join(".");
}

/**
 * Async layered layout. Builds an ELK compound graph from the React Flow
 * nodes + edges (clustering by store-path), runs ELK, and returns nodes
 * with absolute x/y positions. ELK's nested-coordinate output is
 * flattened here so the rest of the app can keep treating React Flow as
 * a flat node list (no `parentId` wiring required).
 */
export async function applyLayout(
  nodes: Node[],
  edges: Edge[],
): Promise<Node[]> {
  if (nodes.length === 0) return [];

  // Map id → node for quick lookup.
  const byId = new Map<string, Node>();
  for (const n of nodes) byId.set(n.id, n);

  // For each visible node, find its "compound parent" — the store node
  // whose own path matches this node's parent-path. Falls back to ROOT
  // when the immediate parent isn't in the visible set (e.g. it's
  // collapsed and filtered out upstream).
  const compoundParentOf = (n: Node): string | null => {
    const pk = parentPathKey(n);
    if (!pk) return null;
    for (const candidate of nodes) {
      if (candidate.type !== "store") continue;
      if (selfPathKey(candidate) === pk) return candidate.id;
    }
    return null;
  };

  // Build the compound tree. Top-level nodes are children of __root__.
  const ROOT = "__root__";
  const childrenByParent = new Map<string, string[]>();
  childrenByParent.set(ROOT, []);
  for (const n of nodes) {
    const p = compoundParentOf(n) ?? ROOT;
    if (!childrenByParent.has(p)) childrenByParent.set(p, []);
    childrenByParent.get(p)!.push(n.id);
  }

  // Recursively build ELK node tree.
  function buildElkNode(id: string): unknown {
    const childIds = childrenByParent.get(id) ?? [];
    const self = id === ROOT ? null : byId.get(id);
    const size = self ? nodeSize(self) : { width: 0, height: 0 };
    return {
      id,
      ...(self ? size : {}),
      layoutOptions: LAYOUT_OPTIONS,
      children: childIds.map(buildElkNode),
    };
  }

  const elkEdges = edges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }));

  const elkGraph = {
    id: ROOT,
    layoutOptions: {
      ...LAYOUT_OPTIONS,
      // Allow edges to cross compound boundaries (wire edges between a
      // process inside one store and a sibling store, etc.).
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    },
    children: (childrenByParent.get(ROOT) ?? []).map(buildElkNode),
    edges: elkEdges,
  };

  // ELK types are loose; cast where needed.
  const result = (await elk.layout(elkGraph as never)) as {
    children?: Array<{ id: string; x?: number; y?: number; children?: unknown[] }>;
  };

  // Walk the result tree, accumulating absolute positions per node.
  const positions = new Map<string, { x: number; y: number }>();
  function walk(n: { id: string; x?: number; y?: number; children?: unknown[] }, parentX = 0, parentY = 0) {
    const absX = parentX + (n.x ?? 0);
    const absY = parentY + (n.y ?? 0);
    if (n.id !== ROOT) positions.set(n.id, { x: absX, y: absY });
    for (const c of (n.children ?? []) as Array<{ id: string; x?: number; y?: number; children?: unknown[] }>) {
      walk(c, absX, absY);
    }
  }
  walk({ id: ROOT, children: result.children });

  return nodes.map((n) => {
    const p = positions.get(n.id);
    return p ? { ...n, position: p } : n;
  });
}

/**
 * Compact layout: tight grid, no hierarchy consideration. Synchronous
 * fallback for tiny composites or environments without async support.
 */
export function applyCompactLayout(nodes: Node[]): Node[] {
  const spacing = 100;
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  return nodes.map((n, i) => ({
    ...n,
    position: {
      x: (i % cols) * spacing,
      y: Math.floor(i / cols) * spacing,
    },
  }));
}
