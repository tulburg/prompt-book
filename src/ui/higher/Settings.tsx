import * as React from "react";

import {
	APPLICATION_SETTINGS_SECTIONS,
	type ApplicationSettingDescriptor,
	type ApplicationSettingKey,
	type ApplicationSettings,
} from "@/lib/application-settings";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";

interface SettingsProps {
	settings: ApplicationSettings;
	descriptors: ApplicationSettingDescriptor[];
	jsonContent: string;
	onChange: <K extends ApplicationSettingKey>(
		key: K,
		value: ApplicationSettings[K],
	) => void;
}

function matchesQuery(descriptor: ApplicationSettingDescriptor, query: string) {
	if (!query) {
		return true;
	}

	const haystack = [
		descriptor.key,
		descriptor.label,
		descriptor.categoryLabel,
		descriptor.description,
		...(descriptor.keywords ?? []),
	]
		.join(" ")
		.toLowerCase();

	return haystack.includes(query.toLowerCase());
}

function ToggleSwitch({
	checked,
	onChange,
}: {
	checked: boolean;
	onChange: (value: boolean) => void;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={() => onChange(!checked)}
			className={cn(
				"relative inline-flex h-[22px] w-[42px] shrink-0 cursor-pointer rounded-full transition-colors duration-200",
				checked ? "bg-emerald-500" : "bg-panel-300",
			)}
		>
			<span
				className={cn(
					"pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200",
					checked ? "translate-x-[22px]" : "translate-x-[2px]",
				)}
				style={{ marginTop: "2px" }}
			/>
		</button>
	);
}

function renderControl(
	descriptor: ApplicationSettingDescriptor,
	value: ApplicationSettings[ApplicationSettingKey],
	onChange: SettingsProps["onChange"],
) {
	switch (descriptor.control) {
		case "boolean":
			return (
				<ToggleSwitch
					checked={Boolean(value)}
					onChange={(next) =>
						onChange(
							descriptor.key,
							next as ApplicationSettings[typeof descriptor.key],
						)
					}
				/>
			);
		case "select":
			return (
				<select
					value={String(value)}
					onChange={(event) =>
						onChange(
							descriptor.key,
							event.target.value as ApplicationSettings[typeof descriptor.key],
						)
					}
					className="h-8 rounded-lg border border-border-500 bg-panel-600 px-3 text-sm text-foreground outline-none transition-colors hover:border-border-300 focus:border-sky-500"
				>
					{descriptor.options?.map((option) => (
						<option key={String(option.value)} value={String(option.value)}>
							{option.label}
						</option>
					))}
				</select>
			);
		case "number":
			return (
				<input
					type="number"
					value={String(value)}
					onChange={(event) =>
						onChange(
							descriptor.key,
							Number(
								event.target.value,
							) as unknown as ApplicationSettings[typeof descriptor.key],
						)
					}
					className="h-8 w-full rounded-lg border border-border-500 bg-panel-600 px-3 text-sm text-foreground outline-none transition-colors hover:border-border-300 focus:border-sky-500"
				/>
			);
		case "textarea":
			return (
				<textarea
					value={String(value)}
					onChange={(event) =>
						onChange(
							descriptor.key,
							event.target.value as ApplicationSettings[typeof descriptor.key],
						)
					}
					className="min-h-28 w-full rounded-lg border border-border-500 bg-panel-600 px-3 py-2 text-sm text-foreground outline-none transition-colors hover:border-border-300 focus:border-sky-500"
					placeholder={descriptor.placeholder}
				/>
			);
		case "password":
			return (
				<input
					type="password"
					value={String(value)}
					onChange={(event) =>
						onChange(
							descriptor.key,
							event.target.value as ApplicationSettings[typeof descriptor.key],
						)
					}
					className="h-8 w-full rounded-lg border border-border-500 bg-panel-600 px-3 text-sm text-foreground outline-none transition-colors hover:border-border-300 focus:border-sky-500"
					placeholder={descriptor.placeholder}
					autoComplete="off"
					spellCheck={false}
				/>
			);
		default:
			return (
				<input
					type="text"
					value={String(value)}
					onChange={(event) =>
						onChange(
							descriptor.key,
							event.target.value as ApplicationSettings[typeof descriptor.key],
						)
					}
					className="h-8 w-full rounded-lg border border-border-500 bg-panel-600 px-3 text-sm text-foreground outline-none transition-colors hover:border-border-300 focus:border-sky-500"
					placeholder={descriptor.placeholder}
				/>
			);
	}
}

interface SubsectionGroup {
	label: string;
	descriptors: ApplicationSettingDescriptor[];
}

function groupBySubsection(
	descriptors: ApplicationSettingDescriptor[],
): SubsectionGroup[] {
	const map = new Map<string, ApplicationSettingDescriptor[]>();
	const order: string[] = [];

	for (const d of descriptors) {
		const key = d.subsection ?? "";
		if (!map.has(key)) {
			map.set(key, []);
			order.push(key);
		}
		map.get(key)?.push(d);
	}

	return order.map((label) => ({
		label,
		descriptors: map.get(label) ?? [],
	}));
}

export function Settings({ descriptors, onChange, settings }: SettingsProps) {
	const [query, setQuery] = React.useState("");
	const [activeSection, setActiveSection] = React.useState(
		APPLICATION_SETTINGS_SECTIONS[0]?.id ?? "",
	);
	const contentRef = React.useRef<HTMLDivElement>(null);

	const filteredSections = React.useMemo(() => {
		const matchedDescriptors = descriptors.filter((descriptor) =>
			matchesQuery(descriptor, query),
		);

		return APPLICATION_SETTINGS_SECTIONS.map((section) => ({
			...section,
			descriptors: matchedDescriptors
				.filter((descriptor) => descriptor.section === section.id)
				.sort((left, right) => left.order - right.order),
		})).filter((section) => section.descriptors.length > 0);
	}, [descriptors, query]);

	React.useEffect(() => {
		if (
			filteredSections.length > 0 &&
			!filteredSections.some((section) => section.id === activeSection)
		) {
			setActiveSection(filteredSections[0].id);
		}
	}, [activeSection, filteredSections]);

	const activeSectionData = filteredSections.find(
		(s) => s.id === activeSection,
	);

	const handleSectionClick = React.useCallback((sectionId: string) => {
		setActiveSection(sectionId);
		contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
	}, []);

	return (
		<div className="flex h-full min-h-0 bg-panel-700">
			<aside className="flex w-56 shrink-0 flex-col border-r border-border-500 bg-panel-700">
				<div className="px-5 pt-5 pb-3">
					<div className="relative">
						<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/35" />
						<input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search settings"
							className="h-8 w-full rounded-lg border border-border-500 bg-panel-600 pl-8 pr-3 text-xs text-foreground outline-none transition-colors placeholder:text-foreground/35 focus:border-sky-500/60"
						/>
					</div>
				</div>

				<nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
					{filteredSections.map((section) => (
						<button
							key={section.id}
							type="button"
							onClick={() => handleSectionClick(section.id)}
							className={cn(
								"flex w-full items-center gap-2.5 rounded-lg px-3 py-[7px] text-[13px] transition-colors",
								activeSection === section.id
									? "bg-panel-500 text-foreground font-medium"
									: "text-foreground/60 hover:bg-panel-600 hover:text-foreground/80",
							)}
						>
							<span>{section.title}</span>
						</button>
					))}
				</nav>
			</aside>

			<div ref={contentRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-2xl px-8 py-6">
					{activeSectionData ? (
						<>
							<h1 className="text-xl font-semibold text-foreground">
								{activeSectionData.title}
							</h1>

							<div className="mt-6 space-y-8">
								{groupBySubsection(activeSectionData.descriptors).map(
									(group) => (
										<div key={group.label}>
											{group.label ? (
												<h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-foreground/40">
													{group.label}
												</h2>
											) : null}

											<div className="divide-y divide-border-500 rounded-xl border border-border-500 bg-panel-600/50">
												{group.descriptors.map((descriptor) => {
													const value = settings[descriptor.key];
													const isBooleanControl =
														descriptor.control === "boolean";

													return (
														<div
															key={descriptor.key}
															className="flex items-center justify-between gap-6 px-4 py-3.5"
														>
															<div className="min-w-0 flex-1">
																<div className="text-[13px] font-medium text-foreground">
																	{descriptor.label}
																</div>
																<div className="mt-0.5 text-xs leading-relaxed text-foreground/40">
																	{descriptor.description}
																</div>
															</div>
															<div
																className={cn(
																	"shrink-0",
																	!isBooleanControl && "w-40",
																)}
															>
																{renderControl(descriptor, value, onChange)}
															</div>
														</div>
													);
												})}
											</div>
										</div>
									),
								)}
							</div>
						</>
					) : (
						<div className="py-16 text-center">
							<div className="text-sm font-medium text-foreground">
								No settings matched your search.
							</div>
							<div className="mt-2 text-xs text-foreground/50">
								Try a broader keyword such as "sidebar", "explorer", or
								"sorting".
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
