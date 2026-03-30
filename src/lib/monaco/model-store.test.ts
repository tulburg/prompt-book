import { afterEach, describe, expect, it } from "vitest";

import {
	createModelUri,
	disposeAllModels,
	disposeModelsForPath,
	getLanguageIdForPath,
	getModelValue,
	registerMonacoInstance,
	renameModels,
	resetMonacoModelStore,
	syncModel,
} from "@/lib/monaco/model-store";

interface FakeModel {
	dispose(): void;
	getLanguageId(): string;
	getValue(): string;
	isDisposed: boolean;
	setLanguage(languageId: string): void;
	setValue(value: string): void;
	uri: {
		path: string;
		toString(): string;
	};
}

function createFakeMonaco() {
	const models = new Map<string, FakeModel>();
	const languages = [
		{ extensions: [".rs"], id: "rust" },
		{ extensions: [".py"], id: "python" },
		{ extensions: [".yml", ".yaml"], id: "yaml" },
		{ filenames: ["dockerfile"], id: "dockerfile" },
		{ filenames: ["makefile"], id: "makefile" },
	];

	const createModel = (value: string, languageId: string, uri: { path: string; toString(): string }) => {
		const model: FakeModel = {
			isDisposed: false,
			uri,
			dispose() {
				model.isDisposed = true;
				models.delete(uri.toString());
			},
			getLanguageId() {
				return languageId;
			},
			getValue() {
				return value;
			},
			setLanguage(nextLanguageId: string) {
				languageId = nextLanguageId;
			},
			setValue(nextValue: string) {
				value = nextValue;
			},
		};

		models.set(uri.toString(), model);
		return model;
	};

	return {
		Uri: {
			from({ path, scheme }: { path: string; scheme: string }) {
				return {
					path,
					toString() {
						return `${scheme}://${path}`;
					},
				};
			},
		},
		languages: {
			getLanguages() {
				return languages;
			},
		},
		editor: {
			createModel,
			getModel(uri: { toString(): string }) {
				return models.get(uri.toString()) ?? null;
			},
			getModels() {
				return [...models.values()];
			},
			setModelLanguage(model: FakeModel, languageId: string) {
				model.setLanguage(languageId);
			},
		},
	};
}

afterEach(() => {
	disposeAllModels();
	resetMonacoModelStore();
});

describe("monaco model store", () => {
	it("maps file extensions to Monaco language ids", () => {
		registerMonacoInstance(createFakeMonaco() as never);

		expect(getLanguageIdForPath("/workspace/file.rs")).toBe("rust");
		expect(getLanguageIdForPath("/workspace/file.py")).toBe("python");
		expect(getLanguageIdForPath("/workspace/file.yml")).toBe("yaml");
		expect(getLanguageIdForPath("/workspace/Dockerfile")).toBe("dockerfile");
		expect(getLanguageIdForPath("/workspace/Makefile")).toBe("makefile");
		expect(getLanguageIdForPath("/workspace/file.tsx")).toBe("typescriptreact");
		expect(getLanguageIdForPath("/workspace/file.unknown")).toBe("plaintext");
	});

	it("creates and updates synced models", () => {
		registerMonacoInstance(createFakeMonaco() as never);

		syncModel("/workspace/file.ts", "const value = 1;");
		expect(getModelValue("/workspace/file.ts")).toBe("const value = 1;");

		syncModel("/workspace/file.ts", "const value = 2;");
		expect(getModelValue("/workspace/file.ts")).toBe("const value = 2;");
		expect(createModelUri("/workspace/file.ts")?.path).toBe("/workspace/file.ts");
	});

	it("renames and disposes model trees by path prefix", () => {
		registerMonacoInstance(createFakeMonaco() as never);

		syncModel("/workspace/src/app.ts", "app");
		syncModel("/workspace/src/lib/util.ts", "util");
		syncModel("/workspace/notes.md", "notes");

		renameModels("/workspace/src", "/workspace/source");
		expect(getModelValue("/workspace/source/app.ts")).toBe("app");
		expect(getModelValue("/workspace/source/lib/util.ts")).toBe("util");
		expect(getModelValue("/workspace/src/app.ts")).toBeNull();

		disposeModelsForPath("/workspace/source");
		expect(getModelValue("/workspace/source/app.ts")).toBeNull();
		expect(getModelValue("/workspace/notes.md")).toBe("notes");
	});
});
