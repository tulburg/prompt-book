import type { SidebarSortOrder } from "./sidebar-tree";

export const SETTINGS_EDITOR_PATH = "prompt-book-settings:/application";

export interface ApplicationSettings {
	"workbench.sidebar.visible": boolean;
	"workbench.sidebar.sortOrder": SidebarSortOrder;
	"explorer.compactFolders": boolean;
	"explorer.fileNesting.enabled": boolean;
	"explorer.autoReveal": boolean;
}

export type ApplicationSettingKey = keyof ApplicationSettings;
export type ApplicationSettingValue =
	ApplicationSettings[ApplicationSettingKey];
export type ApplicationSettingControl =
	| "boolean"
	| "select"
	| "text"
	| "textarea"
	| "number";

export interface ApplicationSettingsSection {
	id: string;
	title: string;
	order: number;
}

export interface ApplicationSettingOption {
	value: string | number | boolean;
	label: string;
	description?: string;
}

export interface ApplicationSettingDescriptor<
	K extends ApplicationSettingKey = ApplicationSettingKey,
> {
	key: K;
	section: string;
	order: number;
	label: string;
	categoryLabel: string;
	description: string;
	control: ApplicationSettingControl;
	defaultValue: ApplicationSettings[K];
	options?: ApplicationSettingOption[];
	placeholder?: string;
	keywords?: string[];
}

export interface SettingsBridge {
	load: () => Promise<ApplicationSettings>;
	save: (settings: ApplicationSettings) => Promise<ApplicationSettings>;
	onOpenRequested?: (listener: () => void) => (() => void) | void;
}

export const SIDEBAR_SORT_ORDER_OPTIONS: SidebarSortOrder[] = [
	"default",
	"files-first",
	"type",
	"modified",
];

export const DEFAULT_APPLICATION_SETTINGS: ApplicationSettings = {
	"workbench.sidebar.visible": true,
	"workbench.sidebar.sortOrder": "default",
	"explorer.compactFolders": true,
	"explorer.fileNesting.enabled": true,
	"explorer.autoReveal": true,
};

export const APPLICATION_SETTINGS_SECTIONS: ApplicationSettingsSection[] = [
	{
		id: "workbench",
		title: "Workbench",
		order: 1,
	},
	{
		id: "explorer",
		title: "Explorer",
		order: 2,
	},
];

export const APPLICATION_SETTINGS_REGISTRY: ApplicationSettingDescriptor[] = [
	{
		key: "workbench.sidebar.visible",
		section: "workbench",
		order: 1,
		label: "Sidebar: Visible",
		categoryLabel: "Workbench",
		description:
			"Controls whether the primary sidebar is shown when the application opens.",
		control: "boolean",
		defaultValue: DEFAULT_APPLICATION_SETTINGS["workbench.sidebar.visible"],
		keywords: ["sidebar", "layout", "visibility"],
	},
	{
		key: "workbench.sidebar.sortOrder",
		section: "workbench",
		order: 2,
		label: "Sidebar: Sort Order",
		categoryLabel: "Workbench",
		description:
			"Controls how files and folders are sorted in the sidebar explorer.",
		control: "select",
		defaultValue: DEFAULT_APPLICATION_SETTINGS["workbench.sidebar.sortOrder"],
		options: [
			{ value: "default", label: "Default" },
			{ value: "files-first", label: "Files First" },
			{ value: "type", label: "Type" },
			{ value: "modified", label: "Modified" },
		],
		keywords: ["sidebar", "sort", "files", "folders"],
	},
	{
		key: "explorer.compactFolders",
		section: "explorer",
		order: 1,
		label: "Explorer: Compact Folders",
		categoryLabel: "Explorer",
		description:
			"Controls whether the explorer compacts chains of single-child folders into a single row.",
		control: "boolean",
		defaultValue: DEFAULT_APPLICATION_SETTINGS["explorer.compactFolders"],
		keywords: ["explorer", "compact", "folders"],
	},
	{
		key: "explorer.fileNesting.enabled",
		section: "explorer",
		order: 2,
		label: "Explorer: File Nesting Enabled",
		categoryLabel: "Explorer",
		description:
			"Controls whether related generated files are nested beneath their primary file in the explorer.",
		control: "boolean",
		defaultValue:
			DEFAULT_APPLICATION_SETTINGS["explorer.fileNesting.enabled"],
		keywords: ["explorer", "nesting", "files"],
	},
	{
		key: "explorer.autoReveal",
		section: "explorer",
		order: 3,
		label: "Explorer: Auto Reveal",
		categoryLabel: "Explorer",
		description:
			"Controls whether the explorer automatically reveals the active editor file.",
		control: "boolean",
		defaultValue: DEFAULT_APPLICATION_SETTINGS["explorer.autoReveal"],
		keywords: ["explorer", "reveal", "active editor"],
	},
];

export function serializeApplicationSettings(settings: ApplicationSettings) {
	return JSON.stringify(settings, null, 2);
}

export function areApplicationSettingsEqual(
	left: ApplicationSettings,
	right: ApplicationSettings,
) {
	return serializeApplicationSettings(left) === serializeApplicationSettings(right);
}

export function sanitizeApplicationSettings(
	value: unknown,
): ApplicationSettings {
	const nextSettings = {
		...DEFAULT_APPLICATION_SETTINGS,
	};

	if (!value || typeof value !== "object") {
		return nextSettings;
	}

	const candidate = value as Partial<Record<ApplicationSettingKey, unknown>>;

	if (typeof candidate["workbench.sidebar.visible"] === "boolean") {
		nextSettings["workbench.sidebar.visible"] =
			candidate["workbench.sidebar.visible"];
	}

	if (
		SIDEBAR_SORT_ORDER_OPTIONS.includes(
			candidate["workbench.sidebar.sortOrder"] as SidebarSortOrder,
		)
	) {
		nextSettings["workbench.sidebar.sortOrder"] =
			candidate["workbench.sidebar.sortOrder"] as SidebarSortOrder;
	}

	if (typeof candidate["explorer.compactFolders"] === "boolean") {
		nextSettings["explorer.compactFolders"] =
			candidate["explorer.compactFolders"];
	}

	if (typeof candidate["explorer.fileNesting.enabled"] === "boolean") {
		nextSettings["explorer.fileNesting.enabled"] =
			candidate["explorer.fileNesting.enabled"];
	}

	if (typeof candidate["explorer.autoReveal"] === "boolean") {
		nextSettings["explorer.autoReveal"] = candidate["explorer.autoReveal"];
	}

	return nextSettings;
}
