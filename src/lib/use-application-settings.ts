import * as React from "react";

import Bus from "./bus";
import { createBrowserSettingsBridge } from "./browser-settings-bridge";
import {
	APPLICATION_SETTINGS_REGISTRY,
	SETTINGS_EDITOR_PATH,
	areApplicationSettingsEqual,
	serializeApplicationSettings,
	type ApplicationSettingDescriptor,
	type ApplicationSettingKey,
	type ApplicationSettings,
	type SettingsBridge,
} from "./application-settings";
import type { ActiveFileState, ProjectPermissions } from "./project-files";

const SETTINGS_FILE_PERMISSIONS: ProjectPermissions = {
	read: true,
	write: true,
	status: "granted",
};

function getSettingsBridge(): SettingsBridge | undefined {
	if (typeof window === "undefined") {
		return undefined;
	}

	return window.settingsBridge ?? createBrowserSettingsBridge();
}

function createSettingsFileState(
	settings: ApplicationSettings,
	savedSettings: ApplicationSettings,
): ActiveFileState {
	return {
		path: SETTINGS_EDITOR_PATH,
		name: "Settings",
		content: serializeApplicationSettings(settings),
		savedContent: serializeApplicationSettings(savedSettings),
		permissions: SETTINGS_FILE_PERMISSIONS,
		isLoading: false,
	};
}

export function useApplicationSettings() {
	const settingsBridge = React.useMemo(() => getSettingsBridge(), []);
	const [settings, setSettings] = React.useState<ApplicationSettings | null>(null);
	const [savedSettings, setSavedSettings] =
		React.useState<ApplicationSettings | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [isBootstrapping, setIsBootstrapping] = React.useState(true);
	const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
	const [isSettingsActive, setIsSettingsActive] = React.useState(false);

	React.useEffect(() => {
		let cancelled = false;

		const restoreSettings = async () => {
			if (!settingsBridge) {
				setIsBootstrapping(false);
				return;
			}

			try {
				const nextSettings = await settingsBridge.load();
				if (!cancelled) {
					setSettings(nextSettings);
					setSavedSettings(nextSettings);
				}
			} catch (loadError) {
				if (!cancelled) {
					setError(
						loadError instanceof Error
							? loadError.message
							: "Failed to load application settings.",
					);
				}
			} finally {
				if (!cancelled) {
					setIsBootstrapping(false);
				}
			}
		};

		void restoreSettings();

		return () => {
			cancelled = true;
		};
	}, [settingsBridge]);

	const openSettings = React.useCallback(() => {
		setIsSettingsOpen(true);
		setIsSettingsActive(true);
	}, []);

	const closeSettings = React.useCallback(() => {
		setIsSettingsOpen(false);
		setIsSettingsActive(false);
	}, []);

	const deactivateSettings = React.useCallback(() => {
		setIsSettingsActive(false);
	}, []);

	const activateSettings = React.useCallback(() => {
		setIsSettingsOpen(true);
		setIsSettingsActive(true);
	}, []);

	React.useEffect(() => {
		const handleOpenSettings = () => {
			openSettings();
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key === ",") {
				event.preventDefault();
				openSettings();
			}
		};

		Bus.on("settings:open", handleOpenSettings);
		window.addEventListener("keydown", handleKeyDown);
		const disposeOpenListener = settingsBridge?.onOpenRequested?.(
			handleOpenSettings,
		);

		return () => {
			Bus.off("settings:open", handleOpenSettings);
			window.removeEventListener("keydown", handleKeyDown);
			disposeOpenListener?.();
		};
	}, [openSettings, settingsBridge]);

	const persistSettings = React.useCallback(
		async (nextSettings: ApplicationSettings) => {
			if (!settingsBridge) {
				return;
			}

			try {
				const persistedSettings = await settingsBridge.save(nextSettings);
				setSavedSettings(persistedSettings);
				setError(null);
			} catch (saveError) {
				setError(
					saveError instanceof Error
						? saveError.message
						: "Failed to save application settings.",
				);
			}
		},
		[settingsBridge],
	);

	React.useEffect(() => {
		if (
			isBootstrapping ||
			!settings ||
			!savedSettings ||
			areApplicationSettingsEqual(settings, savedSettings)
		) {
			return;
		}

		const timeout = window.setTimeout(() => {
			void persistSettings(settings);
		}, 150);

		return () => {
			window.clearTimeout(timeout);
		};
	}, [isBootstrapping, persistSettings, savedSettings, settings]);

	const updateSetting = React.useCallback(
		<K extends ApplicationSettingKey>(
			key: K,
			value: ApplicationSettings[K],
		) => {
			setSettings((current) =>
				current
					? {
							...current,
							[key]: value,
						}
					: current,
			);
		},
		[],
	);

	const saveSettings = React.useCallback(async () => {
		if (!settings) {
			return;
		}

		await persistSettings(settings);
	}, [persistSettings, settings]);

	const settingsFile = React.useMemo(() => {
		if (!settings || !savedSettings) {
			return null;
		}

		return createSettingsFileState(settings, savedSettings);
	}, [savedSettings, settings]);

	return {
		activeSettingsFile: settingsFile,
		activateSettings,
		closeSettings,
		deactivateSettings,
		error,
		isBootstrapping,
		isDirty:
			settings && savedSettings
				? !areApplicationSettingsEqual(settings, savedSettings)
				: false,
		isSettingsActive,
		isSettingsOpen,
		openSettings,
		saveSettings,
		settingDescriptors:
			APPLICATION_SETTINGS_REGISTRY as ApplicationSettingDescriptor[],
		settings,
		settingsJson: settingsFile?.content ?? "",
		updateSetting,
	};
}
