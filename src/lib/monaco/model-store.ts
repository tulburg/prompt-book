import type * as Monaco from "monaco-editor";

type MonacoModule = typeof Monaco;

let monacoInstance: MonacoModule | null = null;

const EXPLICIT_LANGUAGE_OVERRIDES: Record<string, string> = {
	".bashrc": "shell",
	".bash_profile": "shell",
	".env": "shell",
	".env.example": "shell",
	".env.local": "shell",
	".gitignore": "ignore",
	".npmrc": "ini",
	".prettierrc": "json",
	".zprofile": "shell",
	".zshenv": "shell",
	".zshrc": "shell",
	"dockerfile": "dockerfile",
	"makefile": "makefile",
};

function normalizeFilePath(filePath: string) {
	return filePath.replace(/\\/g, "/");
}

function normalizeUriPath(filePath: string) {
	const normalizedPath = normalizeFilePath(filePath);
	if (/^[A-Za-z]:\//.test(normalizedPath)) {
		return `/${normalizedPath}`;
	}

	return normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
}

function normalizePrefix(prefix: string) {
	return normalizeFilePath(prefix).replace(/\/+$/, "");
}

export function registerMonacoInstance(monaco: MonacoModule) {
	monacoInstance = monaco;
}

export function resetMonacoModelStore() {
	monacoInstance = null;
}

function getMonacoInstance() {
	return monacoInstance;
}

function getBasename(filePath: string) {
	const normalizedPath = normalizeFilePath(filePath);
	const segments = normalizedPath.split("/");
	return segments.at(-1)?.toLowerCase() ?? normalizedPath.toLowerCase();
}

function getExtension(filePath: string) {
	const basename = getBasename(filePath);
	const extensionIndex = basename.lastIndexOf(".");
	return extensionIndex > 0 ? basename.slice(extensionIndex) : "";
}

function getFilenamePatterns(language: Monaco.languages.ILanguageExtensionPoint) {
	return language.filenames?.map((filename) => filename.toLowerCase()) ?? [];
}

function getExtensionPatterns(language: Monaco.languages.ILanguageExtensionPoint) {
	return language.extensions?.map((extension) => extension.toLowerCase()) ?? [];
}

export function getLanguageIdForPath(filePath: string) {
	const monaco = getMonacoInstance();
	const basename = getBasename(filePath);
	const normalizedPath = normalizeFilePath(filePath).toLowerCase();
	const extension = getExtension(filePath);

	const explicitLanguage = EXPLICIT_LANGUAGE_OVERRIDES[basename];
	if (explicitLanguage) {
		return explicitLanguage;
	}

	if (!monaco) {
		if (normalizedPath.endsWith(".tsx")) {
			return "typescriptreact";
		}
		if (normalizedPath.endsWith(".ts")) {
			return "typescript";
		}
		if (normalizedPath.endsWith(".jsx")) {
			return "javascriptreact";
		}
		if (
			normalizedPath.endsWith(".js") ||
			normalizedPath.endsWith(".mjs") ||
			normalizedPath.endsWith(".cjs")
		) {
			return "javascript";
		}
		if (normalizedPath.endsWith(".json")) {
			return "json";
		}
		if (normalizedPath.endsWith(".css")) {
			return "css";
		}
		if (normalizedPath.endsWith(".html") || normalizedPath.endsWith(".htm")) {
			return "html";
		}
		if (normalizedPath.endsWith(".md") || normalizedPath.endsWith(".mdx")) {
			return "markdown";
		}
		if (normalizedPath.endsWith(".yml") || normalizedPath.endsWith(".yaml")) {
			return "yaml";
		}
		return "plaintext";
	}

	const languages = monaco.languages.getLanguages();
	const filenameMatch = languages.find((language) =>
		getFilenamePatterns(language).includes(basename),
	);
	if (filenameMatch) {
		return filenameMatch.id;
	}

	const extensionMatch = languages.find((language) =>
		getExtensionPatterns(language).includes(extension),
	);
	if (extensionMatch) {
		return extensionMatch.id;
	}

	if (normalizedPath.endsWith(".tsx")) {
		return "typescriptreact";
	}
	if (normalizedPath.endsWith(".jsx")) {
		return "javascriptreact";
	}
	if (normalizedPath.endsWith(".mdx")) {
		return "mdx";
	}

	return "plaintext";
}

export function createModelUri(filePath: string) {
	const monaco = getMonacoInstance();
	if (!monaco) {
		return null;
	}

	return monaco.Uri.from({
		scheme: "file",
		path: normalizeUriPath(filePath),
	});
}

export function isSameOrDescendantPath(targetPath: string, parentPath: string) {
	const normalizedTargetPath = normalizePrefix(targetPath);
	const normalizedParentPath = normalizePrefix(parentPath);
	return (
		normalizedTargetPath === normalizedParentPath ||
		normalizedTargetPath.startsWith(`${normalizedParentPath}/`)
	);
}

export function getModel(filePath: string) {
	const monaco = getMonacoInstance();
	const uri = createModelUri(filePath);
	if (!monaco || !uri) {
		return null;
	}

	return monaco.editor.getModel(uri);
}

export function getModelValue(filePath: string) {
	return getModel(filePath)?.getValue() ?? null;
}

export function syncModel(filePath: string, content: string) {
	const monaco = getMonacoInstance();
	const uri = createModelUri(filePath);
	if (!monaco || !uri) {
		return null;
	}

	const languageId = getLanguageIdForPath(filePath);
	const existingModel = monaco.editor.getModel(uri);
	if (existingModel) {
		if (existingModel.getLanguageId() !== languageId) {
			monaco.editor.setModelLanguage(existingModel, languageId);
		}
		if (existingModel.getValue() !== content) {
			existingModel.setValue(content);
		}
		return existingModel;
	}

	return monaco.editor.createModel(content, languageId, uri);
}

export function updateModelContent(filePath: string, content: string) {
	const model = getModel(filePath);
	if (model && model.getValue() !== content) {
		model.setValue(content);
	}
	return model;
}

export function renameModels(oldPathPrefix: string, nextPathPrefix: string) {
	const monaco = getMonacoInstance();
	if (!monaco) {
		return;
	}

	for (const model of monaco.editor.getModels()) {
		const currentPath = model.uri.path;
		const normalizedCurrentPath = normalizePrefix(currentPath);
		const normalizedOldPrefix = normalizePrefix(normalizeUriPath(oldPathPrefix));
		if (
			normalizedCurrentPath !== normalizedOldPrefix &&
			!normalizedCurrentPath.startsWith(`${normalizedOldPrefix}/`)
		) {
			continue;
		}

		const suffix = normalizedCurrentPath.slice(normalizedOldPrefix.length);
		const nextFilePath = `${normalizePrefix(nextPathPrefix)}${suffix}`;
		const replacementUri = monaco.Uri.from({
			scheme: "file",
			path: normalizeUriPath(nextFilePath),
		});
		const existingReplacementModel = monaco.editor.getModel(replacementUri);
		if (existingReplacementModel && existingReplacementModel !== model) {
			existingReplacementModel.dispose();
		}

		const replacementModel = monaco.editor.createModel(
			model.getValue(),
			getLanguageIdForPath(nextFilePath),
			replacementUri,
		);
		model.dispose();
		void replacementModel;
	}
}

export function disposeModelsForPath(targetPath: string) {
	const monaco = getMonacoInstance();
	if (!monaco) {
		return;
	}

	const normalizedTargetPath = normalizePrefix(normalizeUriPath(targetPath));
	for (const model of monaco.editor.getModels()) {
		const currentPath = normalizePrefix(model.uri.path);
		if (
			currentPath === normalizedTargetPath ||
			currentPath.startsWith(`${normalizedTargetPath}/`)
		) {
			model.dispose();
		}
	}
}

export function disposeAllModels() {
	const monaco = getMonacoInstance();
	if (!monaco) {
		return;
	}

	for (const model of monaco.editor.getModels()) {
		model.dispose();
	}
}
