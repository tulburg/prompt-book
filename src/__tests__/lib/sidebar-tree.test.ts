import { describe, expect, it } from "vitest";

import { buildSidebarTree, flattenSidebarTree } from "@/lib/sidebar-tree";
import type { ProjectNode } from "@/lib/project-files";

function createNode(
	path: string,
	kind: ProjectNode["kind"],
	children?: ProjectNode[],
): ProjectNode {
	const name = path.split("/").at(-1) ?? path;
	return {
		path,
		name,
		kind,
		parentPath: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) || null : null,
		rootPath: "/workspace",
		permissions: {
			read: true,
			write: true,
			status: "granted",
		},
		children,
		isDirectoryResolved: kind === "directory",
		modifiedAt: 100,
	};
}

describe("sidebar tree", () => {
	it("compacts single-child folder chains", () => {
		const tree = buildSidebarTree(
			[
				createNode("/workspace", "directory", [
					createNode("/workspace/src", "directory", [
						createNode("/workspace/src/lib", "directory", [
							createNode("/workspace/src/lib/file.ts", "file"),
						]),
					]),
				]),
			],
			{
				enableCompactFolders: true,
				enableFileNesting: true,
				sortOrder: "default",
			},
		);

		expect(tree[0]?.children[0]?.displayName).toBe("src/lib");
		expect(tree[0]?.children[0]?.path).toBe("/workspace/src/lib");
	});

	it("nests related files under a preferred parent file", () => {
		const tree = buildSidebarTree(
			[
				createNode("/workspace", "directory", [
					createNode("/workspace/component.tsx", "file"),
					createNode("/workspace/component.test.tsx", "file"),
					createNode("/workspace/component.module.css", "file"),
				]),
			],
			{
				enableCompactFolders: false,
				enableFileNesting: true,
				sortOrder: "default",
			},
		);

		const componentNode = tree[0]?.children.find(
			(node) => node.path === "/workspace/component.tsx",
		);
		expect(componentNode?.nestedChildren.map((node) => node.name)).toEqual([
			"component.module.css",
			"component.test.tsx",
		]);
	});

	it("flattens nested file children when the parent is expanded", () => {
		const tree = buildSidebarTree(
			[
				createNode("/workspace", "directory", [
					createNode("/workspace/component.tsx", "file"),
					createNode("/workspace/component.test.tsx", "file"),
				]),
			],
			{
				enableCompactFolders: false,
				enableFileNesting: true,
				sortOrder: "default",
			},
		);

		const entries = flattenSidebarTree(
			tree,
			new Set(["/workspace"]),
			new Set(["/workspace/component.tsx"]),
		);

		expect(entries.map((entry) => entry.node.path)).toEqual([
			"/workspace",
			"/workspace/component.tsx",
			"/workspace/component.test.tsx",
		]);
	});
});
