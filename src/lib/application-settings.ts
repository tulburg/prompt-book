import type { SidebarSortOrder } from "./sidebar-tree";

export const SETTINGS_EDITOR_PATH = "prompt-book-settings:/application";
export const BASH_PERMITTED_COMMANDS_SETTING =
	"chat.tools.bash.permittedCommands";

export interface ApplicationSettings {
	"workbench.sidebar.visible": boolean;
	"workbench.sidebar.sortOrder": SidebarSortOrder;
	"explorer.compactFolders": boolean;
	"explorer.fileNesting.enabled": boolean;
	"explorer.autoReveal": boolean;
	"chat.providers.google.apiKey": string;
	"chat.providers.anthropic.apiKey": string;
	"chat.providers.openai.apiKey": string;
	[BASH_PERMITTED_COMMANDS_SETTING]: string[];
}

export type ApplicationSettingKey = keyof ApplicationSettings;
export type ApplicationSettingValue =
	ApplicationSettings[ApplicationSettingKey];
export type ApplicationSettingControl =
	| "boolean"
	| "select"
	| "text"
	| "password"
	| "textarea"
	| "number";

export interface ApplicationSettingsSection {
	id: string;
	title: string;
	order: number;
	icon?: string;
	group?: string;
}

export interface ApplicationSettingsGroup {
	id: string;
	label: string;
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
	subsection?: string;
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
	"chat.providers.google.apiKey": "",
	"chat.providers.anthropic.apiKey": "",
	"chat.providers.openai.apiKey": "",
	[BASH_PERMITTED_COMMANDS_SETTING]: [],
};

export const APPLICATION_SETTINGS_GROUPS: ApplicationSettingsGroup[] = [
	{ id: "general", label: "General", order: 1 },
	{ id: "features", label: "Features", order: 2 },
];

export const APPLICATION_SETTINGS_SECTIONS: ApplicationSettingsSection[] = [
	{
		id: "workbench",
		title: "Workbench",
		order: 1,
		group: "general",
	},
	{
		id: "explorer",
		title: "Explorer",
		order: 2,
		group: "features",
	},
	{
		id: "chat",
		title: "Chat",
		order: 3,
		group: "features",
	},
];

export const APPLICATION_SETTINGS_REGISTRY: ApplicationSettingDescriptor[] = [
	{
		key: "workbench.sidebar.visible",
		section: "workbench",
		subsection: "Layout",
		order: 1,
		label: "Sidebar",
		categoryLabel: "Workbench",
		description:
			"Show the primary sidebar when the application opens.",
		control: "boolean",
		defaultValue: DEFAULT_APPLICATION_SETTINGS["workbench.sidebar.visible"],
		keywords: ["sidebar", "layout", "visibility"],
	},
	{
		key: "workbench.sidebar.sortOrder",
		section: "workbench",
		subsection: "Preferences",
		order: 2,
		label: "Sidebar Sort Order",
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
		subsection: "Display",
		order: 1,
		label: "Compact Folders",
		categoryLabel: "Explorer",
		description:
			"Compact chains of single-child folders into a single row.",
		control: "boolean",
		defaultValue: DEFAULT_APPLICATION_SETTINGS["explorer.compactFolders"],
		keywords: ["explorer", "compact", "folders"],
	},
	{
		key: "explorer.fileNesting.enabled",
		section: "explorer",
		subsection: "Display",
		order: 2,
		label: "File Nesting",
		categoryLabel: "Explorer",
		description:
			"Nest related generated files beneath their primary file.",
		control: "boolean",
		defaultValue:
			DEFAULT_APPLICATION_SETTINGS["explorer.fileNesting.enabled"],
		keywords: ["explorer", "nesting", "files"],
	},
	{
		key: "explorer.autoReveal",
		section: "explorer",
		subsection: "Behavior",
		order: 3,
		label: "Auto Reveal",
		categoryLabel: "Explorer",
		description:
			"Automatically reveal the active editor file in the explorer.",
		control: "boolean",
		defaultValue: DEFAULT_APPLICATION_SETTINGS["explorer.autoReveal"],
		keywords: ["explorer", "reveal", "active editor"],
	},
	{
		key: "chat.providers.google.apiKey",
		section: "chat",
		subsection: "Providers",
		order: 1,
		label: "Google Gemini API Key",
		categoryLabel: "Chat",
		description:
			"Adds Gemini models to the chat model picker when a valid API key is configured.",
		control: "password",
		defaultValue: DEFAULT_APPLICATION_SETTINGS["chat.providers.google.apiKey"],
		placeholder: "AIza...",
		keywords: ["chat", "gemini", "google", "api", "key", "models"],
	},
	{
		key: "chat.providers.anthropic.apiKey",
		section: "chat",
		subsection: "Providers",
		order: 2,
		label: "Anthropic API Key",
		categoryLabel: "Chat",
		description:
			"Adds Claude models to the chat model picker when a valid Anthropic API key is configured.",
		control: "password",
		defaultValue:
			DEFAULT_APPLICATION_SETTINGS["chat.providers.anthropic.apiKey"],
		placeholder: "sk-ant-...",
		keywords: ["chat", "anthropic", "claude", "api", "key", "models"],
	},
	{
		key: "chat.providers.openai.apiKey",
		section: "chat",
		subsection: "Providers",
		order: 3,
		label: "OpenAI API Key",
		categoryLabel: "Chat",
		description:
			"Adds OpenAI models to the chat model picker when a valid OpenAI API key is configured.",
		control: "password",
		defaultValue: DEFAULT_APPLICATION_SETTINGS["chat.providers.openai.apiKey"],
		placeholder: "sk-...",
		keywords: ["chat", "openai", "gpt", "api", "key", "models"],
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

	if (typeof candidate["chat.providers.google.apiKey"] === "string") {
		nextSettings["chat.providers.google.apiKey"] =
			candidate["chat.providers.google.apiKey"];
	}

	if (typeof candidate["chat.providers.anthropic.apiKey"] === "string") {
		nextSettings["chat.providers.anthropic.apiKey"] =
			candidate["chat.providers.anthropic.apiKey"];
	}

	if (typeof candidate["chat.providers.openai.apiKey"] === "string") {
		nextSettings["chat.providers.openai.apiKey"] =
			candidate["chat.providers.openai.apiKey"];
	}

	if (Array.isArray(candidate[BASH_PERMITTED_COMMANDS_SETTING])) {
		nextSettings[BASH_PERMITTED_COMMANDS_SETTING] = candidate[
			BASH_PERMITTED_COMMANDS_SETTING
		].filter((value): value is string => typeof value === "string");
	}

	return nextSettings;
}

export function normalizePermittedBashCommand(command: string): string {
	return command.trim();
}

export function getPermittedBashCommands(
	settings: ApplicationSettings | null | undefined,
): string[] {
	return settings?.[BASH_PERMITTED_COMMANDS_SETTING] ?? [];
}

export function addPermittedBashCommand(
	settings: ApplicationSettings,
	command: string,
): ApplicationSettings {
	const normalized = normalizePermittedBashCommand(command);
	if (!normalized) {
		return settings;
	}
	const current = getPermittedBashCommands(settings);
	if (current.includes(normalized)) {
		return settings;
	}
	return {
		...settings,
		[BASH_PERMITTED_COMMANDS_SETTING]: [...current, normalized],
	};
}
