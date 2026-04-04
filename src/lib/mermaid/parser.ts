import type { MermaidNode, MermaidEdge, MermaidGraph, NodeShape, EdgeStyle } from "./types";

const SHAPE_PATTERNS: { regex: RegExp; shape: NodeShape }[] = [
	{ regex: /^\[{2}(.+?)\]{2}$/, shape: "subroutine" },
	{ regex: /^\[\((.+?)\)\]$/, shape: "cylinder" },
	{ regex: /^\(\[(.+?)\]\)$/, shape: "stadium" },
	{ regex: /^\({2}(.+?)\){2}$/, shape: "circle" },
	{ regex: /^\{\{(.+?)\}\}$/, shape: "hexagon" },
	{ regex: /^\{(.+?)\}$/, shape: "diamond" },
	{ regex: /^\((.+?)\)$/, shape: "rounded" },
	{ regex: /^\[(.+?)\]$/, shape: "rect" },
];

const EDGE_PATTERNS: { regex: RegExp; style: EdgeStyle }[] = [
	{ regex: /===>/, style: "thick" },
	{ regex: /==>/, style: "thick" },
	{ regex: /-.->/, style: "dotted" },
	{ regex: /--->/, style: "solid" },
	{ regex: /-->/, style: "solid" },
	{ regex: /---/, style: "solid" },
];

function parseNodeDef(raw: string): { id: string; title: string; shape: NodeShape } | null {
	const trimmed = raw.trim();
	for (const { regex, shape } of SHAPE_PATTERNS) {
		const idMatch = trimmed.match(/^([a-zA-Z_][\w-]*)/);
		if (!idMatch) continue;
		const id = idMatch[1];
		const rest = trimmed.slice(id.length);
		const shapeMatch = rest.match(regex);
		if (shapeMatch) {
			return { id, title: shapeMatch[1].trim(), shape };
		}
	}

	const bareId = trimmed.match(/^([a-zA-Z_][\w-]*)$/);
	if (bareId) {
		return { id: bareId[1], title: bareId[1], shape: "rect" };
	}

	return null;
}

function parseEdge(line: string): { from: string; to: string; label?: string; style: EdgeStyle } | null {
	for (const { regex, style } of EDGE_PATTERNS) {
		const labeledRegex = new RegExp(
			`^([a-zA-Z_][\\w-]*)\\s*${regex.source}\\|([^|]+)\\|\\s*(.+)$`
		);
		const labeledMatch = line.match(labeledRegex);
		if (labeledMatch) {
			return { from: labeledMatch[1], to: labeledMatch[3].trim(), label: labeledMatch[2].trim(), style };
		}

		const simpleRegex = new RegExp(
			`^([a-zA-Z_][\\w-]*)\\s*${regex.source}\\s+(.+)$`
		);
		const simpleMatch = line.match(simpleRegex);
		if (simpleMatch) {
			return { from: simpleMatch[1], to: simpleMatch[2].trim(), style };
		}
	}
	return null;
}

export function parseMermaid(source: string): MermaidGraph {
	const nodes = new Map<string, MermaidNode>();
	const edges: MermaidEdge[] = [];
	const descriptions = new Map<string, string>();

	const lines = source.split("\n");

	for (const rawLine of lines) {
		const line = rawLine.trim();

		if (!line || line.startsWith("flowchart") || line.startsWith("graph") || line === "end") {
			continue;
		}

		if (line.startsWith("subgraph")) {
			continue;
		}

		if (line.startsWith("%% @desc ")) {
			const descMatch = line.match(/^%% @desc\s+(\S+):\s*(.+)$/);
			if (descMatch) {
				descriptions.set(descMatch[1], descMatch[2]);
			}
			continue;
		}

		if (line.startsWith("%%")) {
			continue;
		}

		if (line.startsWith("style") || line.startsWith("classDef") || line.startsWith("class ")) {
			continue;
		}

		const edgeResult = parseEdge(line);
		if (edgeResult) {
			const fromParsed = parseNodeDef(edgeResult.from);
			const toParsed = parseNodeDef(edgeResult.to);

			if (fromParsed && !nodes.has(fromParsed.id)) {
				nodes.set(fromParsed.id, { id: fromParsed.id, title: fromParsed.title, shape: fromParsed.shape });
			}
			if (toParsed && !nodes.has(toParsed.id)) {
				nodes.set(toParsed.id, { id: toParsed.id, title: toParsed.title, shape: toParsed.shape });
			}

			const fromId = fromParsed?.id ?? edgeResult.from;
			const toId = toParsed?.id ?? edgeResult.to;

			if (!nodes.has(fromId)) {
				nodes.set(fromId, { id: fromId, title: fromId, shape: "rect" });
			}
			if (!nodes.has(toId)) {
				nodes.set(toId, { id: toId, title: toId, shape: "rect" });
			}

			edges.push({ from: fromId, to: toId, label: edgeResult.label, style: edgeResult.style });
			continue;
		}

		const nodeDef = parseNodeDef(line);
		if (nodeDef && !nodes.has(nodeDef.id)) {
			nodes.set(nodeDef.id, { id: nodeDef.id, title: nodeDef.title, shape: nodeDef.shape });
		}
	}

	for (const [id, desc] of descriptions) {
		const node = nodes.get(id);
		if (node) {
			node.description = desc;
		}
	}

	return { nodes: Array.from(nodes.values()), edges };
}
