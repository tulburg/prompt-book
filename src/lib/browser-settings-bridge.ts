import {
	DEFAULT_APPLICATION_SETTINGS,
	sanitizeApplicationSettings,
	type ApplicationSettings,
	type SettingsBridge,
} from "./application-settings";

const STORAGE_KEY = "prompt-book-application-settings";

export function createBrowserSettingsBridge(): SettingsBridge | undefined {
	if (typeof window === "undefined") {
		return undefined;
	}

	return {
		async load() {
			try {
				const storedValue = window.localStorage.getItem(STORAGE_KEY);
				if (!storedValue) {
					return DEFAULT_APPLICATION_SETTINGS;
				}

				return sanitizeApplicationSettings(JSON.parse(storedValue));
			} catch {
				return DEFAULT_APPLICATION_SETTINGS;
			}
		},
		async save(settings: ApplicationSettings) {
			const nextSettings = sanitizeApplicationSettings(settings);
			window.localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify(nextSettings),
			);
			return nextSettings;
		},
	};
}
