import type { MermaidGraph, LayoutNode, LayoutEdge, LayoutResult } from "./types";

const NODE_WIDTH = 180;
const NODE_HEIGHT = 50;
const HORIZONTAL_GAP = 100;
const VERTICAL_GAP = 40;
const PADDING = 60;

export function layoutGraph(graph: MermaidGraph): LayoutResult {
	if (graph.nodes.length === 0) {
		return { nodes: [], edges: [], width: 0, height: 0 };
	}

	const adjacency = new Map<string, string[]>();
	const inDegree = new Map<string, number>();

	for (const node of graph.nodes) {
		adjacency.set(node.id, []);
		inDegree.set(node.id, 0);
	}

	for (const edge of graph.edges) {
		adjacency.get(edge.from)?.push(edge.to);
		inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
	}

	// Assign layers using longest-path method
	const layer = new Map<string, number>();
	const visited = new Set<string>();

	function longestPath(nodeId: string): number {
		if (layer.has(nodeId)) return layer.get(nodeId)!;
		if (visited.has(nodeId)) return 0;
		visited.add(nodeId);

		const neighbors = adjacency.get(nodeId) ?? [];
		if (neighbors.length === 0) {
			layer.set(nodeId, 0);
			return 0;
		}

		let maxChild = 0;
		for (const child of neighbors) {
			maxChild = Math.max(maxChild, longestPath(child) + 1);
		}
		layer.set(nodeId, maxChild);
		return maxChild;
	}

	for (const node of graph.nodes) {
		longestPath(node.id);
	}

	// Invert layers so roots are at layer 0
	const maxLayer = Math.max(...Array.from(layer.values()));
	for (const [id, l] of layer) {
		layer.set(id, maxLayer - l);
	}

	// Group nodes by layer
	const layers = new Map<number, string[]>();
	for (const [id, l] of layer) {
		if (!layers.has(l)) layers.set(l, []);
		layers.get(l)!.push(id);
	}

	// Position nodes left-to-right
	const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
	const layoutNodes: LayoutNode[] = [];
	const positions = new Map<string, { x: number; y: number }>();

	const sortedLayers = Array.from(layers.keys()).sort((a, b) => a - b);

	for (const layerIdx of sortedLayers) {
		const nodesInLayer = layers.get(layerIdx)!;
		const x = PADDING + layerIdx * (NODE_WIDTH + HORIZONTAL_GAP);

		for (let i = 0; i < nodesInLayer.length; i++) {
			const nodeId = nodesInLayer[i];
			const y = PADDING + i * (NODE_HEIGHT + VERTICAL_GAP);
			positions.set(nodeId, { x, y });

			const node = nodeMap.get(nodeId)!;
			layoutNodes.push({
				...node,
				x,
				y,
				width: NODE_WIDTH,
				height: NODE_HEIGHT,
			});
		}
	}

	// Create edges with connection points
	const layoutEdges: LayoutEdge[] = graph.edges.map((edge) => {
		const fromPos = positions.get(edge.from);
		const toPos = positions.get(edge.to);

		if (!fromPos || !toPos) {
			return { ...edge, points: [] };
		}

		const startX = fromPos.x + NODE_WIDTH;
		const startY = fromPos.y + NODE_HEIGHT / 2;
		const endX = toPos.x;
		const endY = toPos.y + NODE_HEIGHT / 2;

		const midX = (startX + endX) / 2;

		return {
			...edge,
			points: [
				{ x: startX, y: startY },
				{ x: midX, y: startY },
				{ x: midX, y: endY },
				{ x: endX, y: endY },
			],
		};
	});

	const totalWidth =
		PADDING * 2 + sortedLayers.length * (NODE_WIDTH + HORIZONTAL_GAP) - HORIZONTAL_GAP;
	const maxNodesInLayer = Math.max(...Array.from(layers.values()).map((l) => l.length));
	const totalHeight =
		PADDING * 2 + maxNodesInLayer * (NODE_HEIGHT + VERTICAL_GAP) - VERTICAL_GAP;

	return {
		nodes: layoutNodes,
		edges: layoutEdges,
		width: totalWidth,
		height: totalHeight,
	};
}
