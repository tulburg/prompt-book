import * as React from "react";

import {
  APPLICATION_SETTINGS_SECTIONS,
  type ApplicationSettingDescriptor,
  type ApplicationSettingKey,
  type ApplicationSettings,
} from "@/lib/application-settings";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/lower/Button";
import { Check, Search } from "lucide-react";

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

function renderControl(
  descriptor: ApplicationSettingDescriptor,
  value: ApplicationSettings[ApplicationSettingKey],
  onChange: SettingsProps["onChange"],
) {
  switch (descriptor.control) {
    case "boolean":
      return (
        <label className="inline-flex cursor-pointer items-center justify-end gap-3">
          <span className="text-xs font-medium uppercase tracking-[0.16em] text-foreground/45">
            {value ? "On" : "Off"}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(value)}
            onClick={() =>
              onChange(
                descriptor.key,
                !value as ApplicationSettings[typeof descriptor.key],
              )
            }
            className={cn(
              "relative h-6 w-11 rounded-full border transition-colors",
              value
                ? "border-sky-500/40 bg-sky-500"
                : "border-border-500 bg-panel-500",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white transition-transform",
                value ? "translate-x-0.5" : "-translate-x-4.5",
              )}
            />
          </button>
        </label>
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
          className="h-10 w-full rounded-lg border border-border-500 bg-panel px-3 text-sm text-foreground outline-none transition-colors focus:border-sky-500"
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
          className="h-10 w-full rounded-lg border border-border-500 bg-panel px-3 text-sm text-foreground outline-none transition-colors focus:border-sky-500"
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
          className="min-h-28 w-full rounded-lg border border-border-500 bg-panel px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-sky-500"
          placeholder={descriptor.placeholder}
        />
      );
    case "text":
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
          className="h-10 w-full rounded-lg border border-border-500 bg-panel px-3 text-sm text-foreground outline-none transition-colors focus:border-sky-500"
          placeholder={descriptor.placeholder}
        />
      );
  }
}

export function Settings({
  descriptors,
  jsonContent,
  onChange,
  settings,
}: SettingsProps) {
  const [query, setQuery] = React.useState("");
  const [showJson, setShowJson] = React.useState(false);
  const [activeSection, setActiveSection] = React.useState(
    APPLICATION_SETTINGS_SECTIONS[0]?.id ?? "",
  );

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

  return (
    <div className="h-full min-h-0 bg-panel-700">
      <div className="flex h-full min-h-0">
        <aside className="hidden w-60 shrink-0 border-r border-border-500 bg-panel px-3 py-6 lg:block">
          <div className="px-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground/45">
            Settings
          </div>
          <div className="mt-4 space-y-1">
            {filteredSections.map((section) => (
              <a
                key={section.id}
                href={`#settings-section-${section.id}`}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                  activeSection === section.id
                    ? "bg-sky-500/10 text-sky-100"
                    : "text-foreground/70 hover:bg-panel-500 hover:text-foreground",
                )}
              >
                <span>{section.title}</span>
              </a>
            ))}
          </div>
        </aside>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <div className="mx-auto flex max-w-[1200px] flex-col gap-6 pb-10 pt-6">
            <div className="flex flex-col gap-4 px-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-2xl font-semibold text-foreground">
                    Settings
                  </div>
                  <div className="mt-1 max-w-2xl text-sm leading-6 text-foreground/60">
                    Configure the workbench and explorer using a schema-driven
                    settings surface modeled after Codally and VS Code.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    className="h-9 border border-border-500 bg-panel-600 px-3 text-foreground/80 hover:bg-panel-500"
                    onClick={() => setShowJson((current) => !current)}
                  >
                    {showJson ? "Hide JSON" : "View JSON"}
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative w-full">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search settings"
                    className="h-11 w-full rounded-xl border border-border-500 bg-panel-600 pl-10 pr-4 text-sm text-foreground outline-none transition-colors focus:border-sky-500"
                  />
                </div>
              </div>
            </div>

            {showJson ? (
              <div className="p-4">
                <div className="flex items-center justify-between gap-3 border-b border-border-500 pb-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      Application Settings JSON
                    </div>
                    <div className="mt-1 text-xs text-foreground/50">
                      This snapshot is kept in sync with the persisted
                      application settings store.
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-emerald-300">
                    <Check className="h-3.5 w-3.5" />
                    Saved automatically
                  </div>
                </div>
                <pre className="mt-4 overflow-auto rounded-xl border border-border-500 bg-panel p-4 text-xs leading-6 text-foreground/75">
                  <code>{jsonContent}</code>
                </pre>
              </div>
            ) : null}

            {filteredSections.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="text-sm font-medium text-foreground">
                  No settings matched your search.
                </div>
                <div className="mt-2 text-sm text-foreground/55">
                  Try a broader keyword such as `sidebar`, `explorer`, or
                  `sorting`.
                </div>
              </div>
            ) : (
              filteredSections.map((section) => (
                <section
                  key={section.id}
                  id={`settings-section-${section.id}`}
                  onMouseEnter={() => setActiveSection(section.id)}
                  className="scroll-mt-6 border-t border-border-300 pt-4"
                >
                  <div className="text-lg text-sm text-foreground px-4 font-semibold">
                    {section.title}
                  </div>
                  <div className="overflow-hidden ">
                    {section.descriptors.map((descriptor, index) => {
                      const value = settings[descriptor.key];
                      const isModified = value !== descriptor.defaultValue;

                      return (
                        <div
                          key={descriptor.key}
                          className={cn(
                            "grid gap-4 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start",
                            index > 0 && "border-t border-border-500",
                          )}
                        >
                          <div className="min-w-0 flex flex-col">
                            <div className="mt-2 text-[15px] text-sm text-foreground">
                              {descriptor.label}
                              {isModified ? (
                                <span className="rounded-full ml-2 border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-sky-200">
                                  Modified
                                </span>
                              ) : null}
                            </div>
                            <div className="max-w-3xl text-sm leading-6 text-foreground/40">
                              {descriptor.description}
                            </div>
                          </div>
                          <div className="min-w-0 lg:pt-1">
                            {renderControl(descriptor, value, onChange)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
