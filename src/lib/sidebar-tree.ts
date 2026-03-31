import type { ProjectNode } from "@/lib/project-files";

export type SidebarSortOrder = "default" | "files-first" | "type" | "modified";

export interface SidebarViewNode {
	path: string;
	parentPath: string | null;
	kind: ProjectNode["kind"];
	name: string;
	displayName: string;
	node: ProjectNode;
	compactedPaths: string[];
	children: SidebarViewNode[];
	nestedChildren: SidebarViewNode[];
}

interface BuildSidebarTreeOptions {
	sortOrder: SidebarSortOrder;
	hiddenEntries?: ReadonlySet<string>;
	enableCompactFolders?: boolean;
	enableFileNesting?: boolean;
}

const NESTED_STYLE_EXTENSIONS = new Set(["css", "scss", "sass", "less"]);
const NESTED_VARIANT_PREFIXES = [
	"test",
	"spec",
	"stories",
	"story",
	"module",
	"styles",
	"config",
	"d",
	"types",
	"generated",
	"snap",
];
const PARENT_FILE_PRIORITY = [
	"tsx",
	"ts",
	"jsx",
	"js",
	"vue",
	"svelte",
	"css",
	"scss",
	"sass",
	"less",
];

function compareNodes(
	left: SidebarViewNode,
	right: SidebarViewNode,
	sortOrder: SidebarSortOrder,
) {
	switch (sortOrder) {
		case "files-first":
			if (left.kind !== right.kind) {
				return left.kind === "file" ? -1 : 1;
			}
			return left.name.localeCompare(right.name);
		case "type": {
			if (left.kind !== right.kind) {
				return left.kind === "directory" ? -1 : 1;
			}
			const leftType = left.kind === "file" ? getPrimaryExtension(left.name) : "";
			const rightType = right.kind === "file" ? getPrimaryExtension(right.name) : "";
			return (
				leftType.localeCompare(rightType) || left.name.localeCompare(right.name)
			);
		}
		case "modified": {
			if (left.kind !== right.kind) {
				return left.kind === "directory" ? -1 : 1;
			}
			const leftModified = left.node.modifiedAt ?? 0;
			const rightModified = right.node.modifiedAt ?? 0;
			return rightModified - leftModified || left.name.localeCompare(right.name);
		}
		case "default":
		default:
			if (left.kind !== right.kind) {
				return left.kind === "directory" ? -1 : 1;
			}
			return left.name.localeCompare(right.name);
	}
}

function getPrimaryExtension(name: string) {
	const segments = name.toLowerCase().split(".");
	return segments.length > 1 ? segments.at(-1) ?? "" : "";
}

function stripPrimaryExtension(name: string) {
	const lastDot = name.lastIndexOf(".");
	return lastDot === -1 ? name : name.slice(0, lastDot);
}

function getNestStem(name: string) {
	return name.toLowerCase().split(".")[0] ?? name.toLowerCase();
}

function isHiddenName(name: string, hiddenEntries?: ReadonlySet<string>) {
	return hiddenEntries?.has(name) ?? false;
}

function createLeafViewNode(node: ProjectNode): SidebarViewNode {
	return {
		path: node.path,
		parentPath: node.parentPath,
		kind: node.kind,
		name: node.name,
		displayName: node.name,
		node,
		compactedPaths: [node.path],
		children: [],
		nestedChildren: [],
	};
}

function shouldNestUnderParent(parentName: string, candidateName: string) {
	const parentBase = stripPrimaryExtension(parentName.toLowerCase());
	const candidateLower = candidateName.toLowerCase();

	for (const ext of NESTED_STYLE_EXTENSIONS) {
		if (
			candidateLower === `${parentBase}.${ext}` ||
			candidateLower === `${parentBase}.module.${ext}`
		) {
			return true;
		}
	}

	for (const variant of NESTED_VARIANT_PREFIXES) {
		if (candidateLower.startsWith(`${parentBase}.${variant}.`)) {
			return true;
		}
	}

	return false;
}

function chooseNestParent(files: SidebarViewNode[]) {
	const sorted = [...files].sort((left, right) => {
		const leftExt = getPrimaryExtension(left.name);
		const rightExt = getPrimaryExtension(right.name);
		const leftPriority = PARENT_FILE_PRIORITY.indexOf(leftExt);
		const rightPriority = PARENT_FILE_PRIORITY.indexOf(rightExt);
		const normalizedLeftPriority =
			leftPriority === -1 ? Number.MAX_SAFE_INTEGER : leftPriority;
		const normalizedRightPriority =
			rightPriority === -1 ? Number.MAX_SAFE_INTEGER : rightPriority;
		return (
			normalizedLeftPriority - normalizedRightPriority ||
			left.name.split(".").length - right.name.split(".").length ||
			left.name.localeCompare(right.name)
		);
	});

	return sorted[0] ?? null;
}

function applyFileNesting(
	nodes: SidebarViewNode[],
	sortOrder: SidebarSortOrder,
): SidebarViewNode[] {
	const directories = nodes.filter((node) => node.kind === "directory");
	const files = nodes.filter((node) => node.kind === "file");

	const filesByBase = new Map<string, SidebarViewNode[]>();
	for (const file of files) {
		const base = getNestStem(file.name);
		const current = filesByBase.get(base) ?? [];
		current.push(file);
		filesByBase.set(base, current);
	}

	const nestedChildPaths = new Set<string>();
	const nestedChildrenByParent = new Map<string, SidebarViewNode[]>();

	for (const [base, baseFiles] of filesByBase) {
		if (baseFiles.length < 2) {
			continue;
		}

		const parent = chooseNestParent(baseFiles);
		if (!parent) {
			continue;
		}

		const children = baseFiles.filter(
			(file) =>
				file.path !== parent.path && shouldNestUnderParent(parent.name, file.name),
		);

		if (children.length === 0) {
			continue;
		}

		for (const child of children) {
			nestedChildPaths.add(child.path);
		}

		nestedChildrenByParent.set(
			parent.path,
			[...children].sort((left, right) => compareNodes(left, right, sortOrder)),
		);
		filesByBase.set(
			base,
			baseFiles.filter((file) => file.path === parent.path || !nestedChildPaths.has(file.path)),
		);
	}

	const visibleFiles = files
		.filter((file) => !nestedChildPaths.has(file.path))
		.map((file) => ({
			...file,
			nestedChildren: nestedChildrenByParent.get(file.path) ?? [],
		}));

	return [...directories, ...visibleFiles].sort((left, right) =>
		compareNodes(left, right, sortOrder),
	);
}

function compactDirectoryChain(node: SidebarViewNode): SidebarViewNode {
	let current = node;
	let displayName = node.name;
	const compactedPaths = [...node.compactedPaths];

	while (
		current.kind === "directory" &&
		current.children.length === 1 &&
		current.children[0]?.kind === "directory" &&
		current.children[0].nestedChildren.length === 0
	) {
		const child = current.children[0];
		displayName = `${displayName}/${child.name}`;
		compactedPaths.push(...child.compactedPaths);
		current = child;
	}

	if (current.path === node.path) {
		return node;
	}

	return {
		...current,
		displayName,
		parentPath: node.parentPath,
		compactedPaths,
	};
}

function buildViewNode(
	node: ProjectNode,
	options: BuildSidebarTreeOptions,
	isRoot = false,
): SidebarViewNode | null {
	if (isHiddenName(node.name, options.hiddenEntries)) {
		return null;
	}

	if (node.kind === "file") {
		return createLeafViewNode(node);
	}

	const children = (node.children ?? [])
		.map((child) => buildViewNode(child, options))
		.filter((child): child is SidebarViewNode => child !== null);

	const sortedChildren = [...children].sort((left, right) =>
		compareNodes(left, right, options.sortOrder),
	);
	const finalChildren = options.enableFileNesting
		? applyFileNesting(sortedChildren, options.sortOrder)
		: sortedChildren;

	const viewNode: SidebarViewNode = {
		path: node.path,
		parentPath: node.parentPath,
		kind: node.kind,
		name: node.name,
		displayName: node.name,
		node,
		compactedPaths: [node.path],
		children: finalChildren,
		nestedChildren: [],
	};

	if (options.enableCompactFolders && !isRoot) {
		return compactDirectoryChain(viewNode);
	}

	return viewNode;
}

function filterViewNode(
	node: SidebarViewNode,
	filter: string,
): SidebarViewNode | null {
	if (!filter) {
		return node;
	}

	const lower = filter.toLowerCase();
	const filteredChildren = node.children
		.map((child) => filterViewNode(child, filter))
		.filter((child): child is SidebarViewNode => child !== null);
	const filteredNestedChildren = node.nestedChildren
		.map((child) => filterViewNode(child, filter))
		.filter((child): child is SidebarViewNode => child !== null);

	if (
		node.displayName.toLowerCase().includes(lower) ||
		filteredChildren.length > 0 ||
		filteredNestedChildren.length > 0
	) {
		return {
			...node,
			children: filteredChildren,
			nestedChildren: filteredNestedChildren,
		};
	}

	return null;
}

export function buildSidebarTree(
	roots: ProjectNode[],
	options: BuildSidebarTreeOptions & { filter?: string },
): SidebarViewNode[] {
	return roots
		.map((root) => buildViewNode(root, options, true))
		.filter((root): root is SidebarViewNode => root !== null)
		.map((root) => filterViewNode(root, options.filter ?? ""))
		.filter((root): root is SidebarViewNode => root !== null);
}

export interface FlatSidebarEntry {
	node: SidebarViewNode;
	depth: number;
	parentPath: string | null;
}

export function flattenSidebarTree(
	nodes: SidebarViewNode[],
	expandedPaths: ReadonlySet<string>,
	expandedNestedPaths: ReadonlySet<string>,
	depth = 0,
	parentPath: string | null = null,
): FlatSidebarEntry[] {
	const entries: FlatSidebarEntry[] = [];

	for (const node of nodes) {
		entries.push({ node, depth, parentPath });

		if (node.kind === "directory" && expandedPaths.has(node.path)) {
			entries.push(
				...flattenSidebarTree(
					node.children,
					expandedPaths,
					expandedNestedPaths,
					depth + 1,
					node.path,
				),
			);
		}

		if (node.nestedChildren.length > 0 && expandedNestedPaths.has(node.path)) {
			entries.push(
				...flattenSidebarTree(
					node.nestedChildren,
					expandedPaths,
					expandedNestedPaths,
					depth + 1,
					node.path,
				),
			);
		}
	}

	return entries;
}

export function matchesViewPath(node: SidebarViewNode, targetPath: string | null) {
	if (!targetPath) {
		return false;
	}

	return node.path === targetPath || node.compactedPaths.includes(targetPath);
}
