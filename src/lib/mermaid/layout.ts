import type { MermaidGraph, LayoutNode, LayoutEdge, LayoutResult } from "./types";

const NODE_WIDTH = 180;
const NODE_HEIGHT = 50;
const HORIZONTAL_GAP = 80;
const VERTICAL_GAP = 60;
const PADDING = 60;
const SWEEP_ITERATIONS = 24;

export function layoutGraph(graph: MermaidGraph): LayoutResult {
	if (graph.nodes.length === 0) {
		return { nodes: [], edges: [], width: 0, height: 0 };
	}

	// Build adjacency structures
	const children = new Map<string, string[]>();
	const parents = new Map<string, string[]>();

	for (const node of graph.nodes) {
		children.set(node.id, []);
		parents.set(node.id, []);
	}

	for (const edge of graph.edges) {
		children.get(edge.from)?.push(edge.to);
		parents.get(edge.to)?.push(edge.from);
	}

	// Assign layers using longest-path method
	const layer = new Map<string, number>();
	const visited = new Set<string>();

	function longestPath(nodeId: string): number {
		if (layer.has(nodeId)) return layer.get(nodeId)!;
		if (visited.has(nodeId)) return 0;
		visited.add(nodeId);

		const neighbors = children.get(nodeId) ?? [];
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

	// Invert so roots are at layer 0
	const maxLayer = Math.max(...Array.from(layer.values()));
	for (const [id, l] of layer) {
		layer.set(id, maxLayer - l);
	}

	// Group nodes by layer
	const layerNodes = new Map<number, string[]>();
	for (const [id, l] of layer) {
		if (!layerNodes.has(l)) layerNodes.set(l, []);
		layerNodes.get(l)!.push(id);
	}

	const sortedLayers = Array.from(layerNodes.keys()).sort((a, b) => a - b);

	// --- Barycenter ordering with multi-pass sweeping ---
	// Initialize positions: index within layer
	const position = new Map<string, number>();
	for (const layerIdx of sortedLayers) {
		const nodes = layerNodes.get(layerIdx)!;
		for (let i = 0; i < nodes.length; i++) {
			position.set(nodes[i], i);
		}
	}

	function barycenter(neighborIds: string[]): number | null {
		if (neighborIds.length === 0) return null;
		let sum = 0;
		for (const nid of neighborIds) {
			sum += position.get(nid) ?? 0;
		}
		return sum / neighborIds.length;
	}

	for (let iter = 0; iter < SWEEP_ITERATIONS; iter++) {
		// Down sweep: order each layer based on parents in the layer above
		for (let i = 1; i < sortedLayers.length; i++) {
			const layerIdx = sortedLayers[i];
			const nodes = layerNodes.get(layerIdx)!;

			const barycenters = new Map<string, number>();
			for (const nodeId of nodes) {
				const parentIds = parents.get(nodeId) ?? [];
				const bc = barycenter(parentIds);
				barycenters.set(nodeId, bc ?? position.get(nodeId) ?? 0);
			}

			nodes.sort((a, b) => barycenters.get(a)! - barycenters.get(b)!);

			for (let j = 0; j < nodes.length; j++) {
				position.set(nodes[j], j);
			}
		}

		// Up sweep: order each layer based on children in the layer below
		for (let i = sortedLayers.length - 2; i >= 0; i--) {
			const layerIdx = sortedLayers[i];
			const nodes = layerNodes.get(layerIdx)!;

			const barycenters = new Map<string, number>();
			for (const nodeId of nodes) {
				const childIds = children.get(nodeId) ?? [];
				const bc = barycenter(childIds);
				barycenters.set(nodeId, bc ?? position.get(nodeId) ?? 0);
			}

			nodes.sort((a, b) => barycenters.get(a)! - barycenters.get(b)!);

			for (let j = 0; j < nodes.length; j++) {
				position.set(nodes[j], j);
			}
		}
	}

	// --- Median x-positioning ---
	// Assign x coordinates based on neighbor medians rather than even spacing
	const xPos = new Map<string, number>();

	// Initial pass: even spacing
	for (const layerIdx of sortedLayers) {
		const nodes = layerNodes.get(layerIdx)!;
		for (let i = 0; i < nodes.length; i++) {
			xPos.set(nodes[i], PADDING + i * (NODE_WIDTH + HORIZONTAL_GAP));
		}
	}

	// Refine: pull nodes toward the median of their neighbors
	for (let iter = 0; iter < 8; iter++) {
		// Down pass
		for (let i = 1; i < sortedLayers.length; i++) {
			const nodes = layerNodes.get(sortedLayers[i])!;
			const desired = new Map<string, number>();

			for (const nodeId of nodes) {
				const parentIds = parents.get(nodeId) ?? [];
				if (parentIds.length === 0) {
					desired.set(nodeId, xPos.get(nodeId)!);
					continue;
				}
				const parentXs = parentIds.map((p) => xPos.get(p)!).sort((a, b) => a - b);
				const median =
					parentXs.length % 2 === 1
						? parentXs[Math.floor(parentXs.length / 2)]
						: (parentXs[parentXs.length / 2 - 1] + parentXs[parentXs.length / 2]) / 2;
				desired.set(nodeId, median);
			}

			// Sort by desired position and assign without overlap
			const sorted = [...nodes].sort(
				(a, b) => desired.get(a)! - desired.get(b)!,
			);
			placeWithoutOverlap(sorted, desired, xPos);
		}

		// Up pass
		for (let i = sortedLayers.length - 2; i >= 0; i--) {
			const nodes = layerNodes.get(sortedLayers[i])!;
			const desired = new Map<string, number>();

			for (const nodeId of nodes) {
				const childIds = children.get(nodeId) ?? [];
				if (childIds.length === 0) {
					desired.set(nodeId, xPos.get(nodeId)!);
					continue;
				}
				const childXs = childIds.map((c) => xPos.get(c)!).sort((a, b) => a - b);
				const median =
					childXs.length % 2 === 1
						? childXs[Math.floor(childXs.length / 2)]
						: (childXs[childXs.length / 2 - 1] + childXs[childXs.length / 2]) / 2;
				desired.set(nodeId, median);
			}

			const sorted = [...nodes].sort(
				(a, b) => desired.get(a)! - desired.get(b)!,
			);
			placeWithoutOverlap(sorted, desired, xPos);
		}
	}

	// Normalize: shift all x positions so minimum is PADDING
	let minX = Infinity;
	for (const x of xPos.values()) {
		if (x < minX) minX = x;
	}
	const xShift = PADDING - minX;
	for (const [id, x] of xPos) {
		xPos.set(id, x + xShift);
	}

	// --- Build layout nodes ---
	const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
	const layoutNodes: LayoutNode[] = [];
	const positions = new Map<string, { x: number; y: number }>();

	for (const layerIdx of sortedLayers) {
		const nodes = layerNodes.get(layerIdx)!;
		const y = PADDING + layerIdx * (NODE_HEIGHT + VERTICAL_GAP);

		for (const nodeId of nodes) {
			const x = xPos.get(nodeId)!;
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

	// --- Build edges ---
	const layoutEdges: LayoutEdge[] = graph.edges.map((edge) => {
		const fromPos = positions.get(edge.from);
		const toPos = positions.get(edge.to);

		if (!fromPos || !toPos) {
			return { ...edge, points: [] };
		}

		const startX = fromPos.x + NODE_WIDTH / 2;
		const startY = fromPos.y + NODE_HEIGHT;
		const endX = toPos.x + NODE_WIDTH / 2;
		const endY = toPos.y;

		const midY = (startY + endY) / 2;

		return {
			...edge,
			points: [
				{ x: startX, y: startY },
				{ x: startX, y: midY },
				{ x: endX, y: midY },
				{ x: endX, y: endY },
			],
		};
	});

	// --- Compute canvas size ---
	let maxX = 0;
	for (const node of layoutNodes) {
		const right = node.x + NODE_WIDTH;
		if (right > maxX) maxX = right;
	}
	const totalWidth = maxX + PADDING;
	const totalHeight =
		PADDING * 2 + sortedLayers.length * (NODE_HEIGHT + VERTICAL_GAP) - VERTICAL_GAP;

	return {
		nodes: layoutNodes,
		edges: layoutEdges,
		width: totalWidth,
		height: totalHeight,
	};
}

/** Place nodes at their desired x, pushing apart to prevent overlap */
function placeWithoutOverlap(
	sortedNodes: string[],
	desired: Map<string, number>,
	xPos: Map<string, number>,
): void {
	const minSpacing = NODE_WIDTH + HORIZONTAL_GAP;

	// Place left to right, ensuring minimum spacing
	for (let i = 0; i < sortedNodes.length; i++) {
		const nodeId = sortedNodes[i];
		let x = desired.get(nodeId)!;

		if (i > 0) {
			const prevX = xPos.get(sortedNodes[i - 1])!;
			x = Math.max(x, prevX + minSpacing);
		}

		xPos.set(nodeId, x);
	}

	// Right to left pass: pull nodes back toward desired if space allows
	for (let i = sortedNodes.length - 2; i >= 0; i--) {
		const nodeId = sortedNodes[i];
		const nextX = xPos.get(sortedNodes[i + 1])!;
		const des = desired.get(nodeId)!;
		const currentX = xPos.get(nodeId)!;

		// Try to move closer to desired, but don't exceed next node's boundary
		const maxAllowed = nextX - minSpacing;
		const target = Math.max(des, i > 0 ? xPos.get(sortedNodes[i - 1])! + minSpacing : PADDING);
		xPos.set(nodeId, Math.min(maxAllowed, Math.max(currentX, target)));
	}
}
