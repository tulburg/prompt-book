import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "../lower/Button";
import { parseMermaid } from "@/lib/mermaid/parser";
import { layoutGraph } from "@/lib/mermaid/layout";
import { DEFAULT_MERMAID_FLOW } from "@/lib/mermaid/default-flow";
import type { LayoutNode, LayoutEdge } from "@/lib/mermaid/types";

interface MermaidViewerProps {
	open: boolean;
	onClose: () => void;
}

interface DragState {
	nodeId: string;
	startX: number;
	startY: number;
	nodeStartX: number;
	nodeStartY: number;
}

interface PanState {
	startX: number;
	startY: number;
	offsetStartX: number;
	offsetStartY: number;
}

function getNodeClipPath(shape: string): string | undefined {
	switch (shape) {
		case "diamond":
			return "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)";
		case "hexagon":
			return "polygon(10% 0%, 90% 0%, 100% 50%, 90% 100%, 10% 100%, 0% 50%)";
		default:
			return undefined;
	}
}

function getNodeRadius(shape: string): string {
	switch (shape) {
		case "rounded":
		case "stadium":
			return "9999px";
		case "circle":
			return "50%";
		case "cylinder":
			return "8px";
		default:
			return "8px";
	}
}

function EdgePath({ edge }: { edge: LayoutEdge }) {
	if (edge.points.length < 2) return null;

	const [start, cp1, cp2, end] = edge.points;
	const d =
		edge.points.length === 4
			? `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`
			: `M ${start.x} ${start.y} L ${end.x} ${end.y}`;

	const dashArray = edge.style === "dotted" ? "6,4" : undefined;
	const strokeWidth = edge.style === "thick" ? 2.5 : 1.5;

	return (
		<g>
			<path
				d={d}
				fill="none"
				stroke="oklch(50% 0 0)"
				strokeWidth={strokeWidth}
				strokeDasharray={dashArray}
				markerEnd="url(#arrowhead)"
			/>
			{edge.label && (
				<text
					x={(start.x + end.x) / 2}
					y={(start.y + end.y) / 2 - 8}
					textAnchor="middle"
					className="fill-foreground/60 text-[10px]"
				>
					{edge.label}
				</text>
			)}
		</g>
	);
}

function NodeBox({
	node,
	onMouseDown,
	onClick,
	isSelected,
}: {
	node: LayoutNode;
	onMouseDown: (e: React.MouseEvent) => void;
	onClick: () => void;
	isSelected: boolean;
}) {
	const clipPath = getNodeClipPath(node.shape);
	const borderRadius = getNodeRadius(node.shape);

	return (
		<div
			onMouseDown={onMouseDown}
			onClick={onClick}
			className={`absolute flex cursor-grab items-center justify-center border px-3 text-center text-xs font-medium select-none ${
				isSelected
					? "border-sky-500 bg-sky-500/15 text-sky-300"
					: "border-border-500 bg-panel-600 text-foreground/85 hover:border-sky-500/50 hover:bg-panel-500"
			}`}
			style={{
				left: node.x,
				top: node.y,
				width: node.width,
				height: node.height,
				borderRadius,
				clipPath,
				transition: "border-color 150ms, background-color 150ms",
			}}
		>
			{node.title}
		</div>
	);
}

export function MermaidViewer({ open, onClose }: MermaidViewerProps) {
	const [nodes, setNodes] = React.useState<LayoutNode[]>([]);
	const [edges, setEdges] = React.useState<LayoutEdge[]>([]);
	const [canvasSize, setCanvasSize] = React.useState({ width: 0, height: 0 });
	const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
	const [offset, setOffset] = React.useState({ x: 0, y: 0 });
	const [zoom, setZoom] = React.useState(1);

	const dragRef = React.useRef<DragState | null>(null);
	const panRef = React.useRef<PanState | null>(null);
	const containerRef = React.useRef<HTMLDivElement | null>(null);
	const didDragRef = React.useRef(false);

	React.useEffect(() => {
		if (!open) return;

		const graph = parseMermaid(DEFAULT_MERMAID_FLOW);
		const result = layoutGraph(graph);
		setNodes(result.nodes);
		setEdges(result.edges);
		setCanvasSize({ width: result.width, height: result.height });
		setSelectedNodeId(null);
		setOffset({ x: 40, y: 40 });
		setZoom(1);
	}, [open]);

	React.useEffect(() => {
		if (!open) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (selectedNodeId) {
					setSelectedNodeId(null);
				} else {
					onClose();
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [open, onClose, selectedNodeId]);

	const handleNodeMouseDown = React.useCallback(
		(nodeId: string, e: React.MouseEvent) => {
			e.stopPropagation();
			didDragRef.current = false;
			dragRef.current = {
				nodeId,
				startX: e.clientX,
				startY: e.clientY,
				nodeStartX: nodes.find((n) => n.id === nodeId)?.x ?? 0,
				nodeStartY: nodes.find((n) => n.id === nodeId)?.y ?? 0,
			};
		},
		[nodes],
	);

	const handleCanvasMouseDown = React.useCallback(
		(e: React.MouseEvent) => {
			if (e.target !== e.currentTarget && !(e.target as HTMLElement).closest("svg")) return;
			panRef.current = {
				startX: e.clientX,
				startY: e.clientY,
				offsetStartX: offset.x,
				offsetStartY: offset.y,
			};
		},
		[offset],
	);

	React.useEffect(() => {
		if (!open) return;

		const handleMouseMove = (e: MouseEvent) => {
			if (dragRef.current) {
				const dx = (e.clientX - dragRef.current.startX) / zoom;
				const dy = (e.clientY - dragRef.current.startY) / zoom;

				if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
					didDragRef.current = true;
				}

				const newX = dragRef.current.nodeStartX + dx;
				const newY = dragRef.current.nodeStartY + dy;

				setNodes((prev) =>
					prev.map((n) =>
						n.id === dragRef.current!.nodeId ? { ...n, x: newX, y: newY } : n,
					),
				);

				setEdges((prev) =>
					prev.map((edge) => {
						if (edge.from !== dragRef.current!.nodeId && edge.to !== dragRef.current!.nodeId) {
							return edge;
						}
						const fromNode =
							edge.from === dragRef.current!.nodeId
								? { x: newX, y: newY, width: 180, height: 50 }
								: (() => {
										const n = nodes.find((nd) => nd.id === edge.from);
										return n ?? { x: 0, y: 0, width: 180, height: 50 };
									})();
						const toNode =
							edge.to === dragRef.current!.nodeId
								? { x: newX, y: newY, width: 180, height: 50 }
								: (() => {
										const n = nodes.find((nd) => nd.id === edge.to);
										return n ?? { x: 0, y: 0, width: 180, height: 50 };
									})();

						const startX = fromNode.x + fromNode.width;
						const startY = fromNode.y + fromNode.height / 2;
						const endX = toNode.x;
						const endY = toNode.y + toNode.height / 2;
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
					}),
				);
			} else if (panRef.current) {
				const dx = e.clientX - panRef.current.startX;
				const dy = e.clientY - panRef.current.startY;
				setOffset({
					x: panRef.current.offsetStartX + dx,
					y: panRef.current.offsetStartY + dy,
				});
			}
		};

		const handleMouseUp = () => {
			dragRef.current = null;
			panRef.current = null;
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}, [open, zoom, nodes]);

	const handleWheel = React.useCallback((e: React.WheelEvent) => {
		e.preventDefault();
		setZoom((prev) => Math.min(3, Math.max(0.2, prev - e.deltaY * 0.001)));
	}, []);

	const handleNodeClick = React.useCallback((nodeId: string) => {
		if (didDragRef.current) return;
		setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId));
	}, []);

	if (!open) return null;

	const selectedNode = nodes.find((n) => n.id === selectedNodeId);

	return createPortal(
		<div className="fixed inset-0 z-[1200] flex flex-col bg-panel">
			{/* Header bar */}
			<div className="flex h-10 shrink-0 items-center justify-between border-b border-border-500 px-4">
				<span className="text-sm font-medium text-foreground/85">Flow Viewer</span>
				<Button
					size="icon"
					variant="ghost"
					className="h-7 w-7"
					aria-label="Close flow viewer"
					onClick={onClose}
				>
					<X className="h-4 w-4" />
				</Button>
			</div>

			{/* Canvas area */}
			<div
				ref={containerRef}
				className="relative flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
				onMouseDown={handleCanvasMouseDown}
				onWheel={handleWheel}
			>
				<div
					style={{
						transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
						transformOrigin: "0 0",
						width: canvasSize.width,
						height: canvasSize.height,
						position: "relative",
					}}
				>
					{/* SVG edges */}
					<svg
						className="pointer-events-none absolute inset-0"
						style={{ width: canvasSize.width, height: canvasSize.height }}
					>
						<defs>
							<marker
								id="arrowhead"
								markerWidth="10"
								markerHeight="7"
								refX="9"
								refY="3.5"
								orient="auto"
							>
								<polygon points="0 0, 10 3.5, 0 7" fill="oklch(50% 0 0)" />
							</marker>
						</defs>
						{edges.map((edge, i) => (
							<EdgePath key={`${edge.from}-${edge.to}-${i}`} edge={edge} />
						))}
					</svg>

					{/* Nodes */}
					{nodes.map((node) => (
						<NodeBox
							key={node.id}
							node={node}
							isSelected={node.id === selectedNodeId}
							onMouseDown={(e) => handleNodeMouseDown(node.id, e)}
							onClick={() => handleNodeClick(node.id)}
						/>
					))}
				</div>

				{/* Floating description popup */}
				{selectedNode?.description && (
					<div
						className="absolute z-10 max-w-sm rounded-xl border border-border-500 bg-panel-600 p-4 shadow-2xl"
						style={{
							left: selectedNode.x * zoom + offset.x + selectedNode.width * zoom + 12,
							top: selectedNode.y * zoom + offset.y,
						}}
					>
						<div className="mb-2 text-sm font-semibold text-foreground">
							{selectedNode.title}
						</div>
						<div className="text-xs leading-relaxed text-foreground/70">
							{selectedNode.description}
						</div>
					</div>
				)}
			</div>
		</div>,
		document.body,
	);
}
