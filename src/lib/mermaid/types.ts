export type NodeShape =
	| "rect"
	| "rounded"
	| "diamond"
	| "stadium"
	| "subroutine"
	| "cylinder"
	| "circle"
	| "hexagon";

export type EdgeStyle = "solid" | "dotted" | "thick";

export interface MermaidNode {
	id: string;
	title: string;
	shape: NodeShape;
	description?: string;
}

export interface MermaidEdge {
	from: string;
	to: string;
	label?: string;
	style: EdgeStyle;
}

export interface MermaidGraph {
	nodes: MermaidNode[];
	edges: MermaidEdge[];
}

export interface LayoutNode extends MermaidNode {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface LayoutEdge extends MermaidEdge {
	points: { x: number; y: number }[];
}

export interface LayoutResult {
	nodes: LayoutNode[];
	edges: LayoutEdge[];
	width: number;
	height: number;
}
