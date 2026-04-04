import * as React from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
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

function ZoomControls({
	zoom,
	onZoomIn,
	onZoomOut,
	onReset,
}: {
	zoom: number;
	onZoomIn: () => void;
	onZoomOut: () => void;
	onReset: () => void;
}) {
	return (
		<div className="absolute bottom-4 right-4 z-20 flex items-center gap-1 rounded-lg border border-border-500 bg-panel-600 p-1 shadow-lg">
			<Button
				size="icon"
				variant="ghost"
				className="h-7 w-7"
				aria-label="Zoom out"
				onClick={onZoomOut}
			>
				<Minus className="h-3.5 w-3.5" />
			</Button>
			<button
				type="button"
				onClick={onReset}
				className="min-w-[48px] rounded px-1.5 py-1 text-center text-xs text-foreground/70 hover:bg-panel-500"
			>
				{Math.round(zoom * 100)}%
			</button>
			<Button
				size="icon"
				variant="ghost"
				className="h-7 w-7"
				aria-label="Zoom in"
				onClick={onZoomIn}
			>
				<Plus className="h-3.5 w-3.5" />
			</Button>
			<Button
				size="icon"
				variant="ghost"
				className="h-7 w-7"
				aria-label="Reset view"
				onClick={onReset}
			>
				<RotateCcw className="h-3.5 w-3.5" />
			</Button>
		</div>
	);
}

export function MermaidViewer({ open, onClose }: MermaidViewerProps) {
	const [nodes, setNodes] = React.useState<LayoutNode[]>([]);
	const [edges, setEdges] = React.useState<LayoutEdge[]>([]);
	const [canvasSize, setCanvasSize] = React.useState({ width: 0, height: 0 });
	const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
	const [zoom, setZoom] = React.useState(1);

	const dragRef = React.useRef<DragState | null>(null);
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

	React.useEffect(() => {
		if (!open) return;

		const handleMouseMove = (e: MouseEvent) => {
			if (!dragRef.current) return;

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
		};

		const handleMouseUp = () => {
			dragRef.current = null;
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}, [open, zoom, nodes]);

	const handleWheel = React.useCallback((e: React.WheelEvent) => {
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			setZoom((prev) => Math.min(3, Math.max(0.2, prev - e.deltaY * 0.005)));
		}
	}, []);

	const handleNodeClick = React.useCallback((nodeId: string) => {
		if (didDragRef.current) return;
		setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId));
	}, []);

	const zoomIn = React.useCallback(() => {
		setZoom((prev) => Math.min(3, prev + 0.15));
	}, []);

	const zoomOut = React.useCallback(() => {
		setZoom((prev) => Math.max(0.2, prev - 0.15));
	}, []);

	const resetZoom = React.useCallback(() => {
		setZoom(1);
		if (containerRef.current) {
			containerRef.current.scrollTo({ left: 0, top: 0, behavior: "smooth" });
		}
	}, []);

	if (!open) return null;

	const selectedNode = nodes.find((n) => n.id === selectedNodeId);

	// Canvas should be at least the window size, or larger if content overflows
	const scaledWidth = canvasSize.width * zoom;
	const scaledHeight = canvasSize.height * zoom;

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

			{/* Canvas area — scrollable */}
			<div
				ref={containerRef}
				className="relative flex-1 overflow-auto"
				onWheel={handleWheel}
			>
				<div
					style={{
						minWidth: "100%",
						minHeight: "100%",
						width: scaledWidth > 0 ? scaledWidth : "100%",
						height: scaledHeight > 0 ? scaledHeight : "100%",
						position: "relative",
					}}
				>
					<div
						style={{
							transform: `scale(${zoom})`,
							transformOrigin: "0 0",
							width: canvasSize.width,
							height: canvasSize.height,
							position: "absolute",
							top: 0,
							left: 0,
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

						{/* Floating description popup — below the node */}
						{selectedNode?.description && (
							<div
								className="absolute z-10 max-w-sm rounded-xl border border-border-500 bg-panel-600 p-4 shadow-2xl"
								style={{
									left: selectedNode.x,
									top: selectedNode.y + selectedNode.height + 10,
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
				</div>

				{/* Zoom controls */}
				<ZoomControls
					zoom={zoom}
					onZoomIn={zoomIn}
					onZoomOut={zoomOut}
					onReset={resetZoom}
				/>
			</div>
		</div>,
		document.body,
	);
}
