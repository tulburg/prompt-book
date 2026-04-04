import {
	Menu,
	Network,
	Search,
	Settings,
	Sidebar as SidebarIcon,
	X,
} from "lucide-react";
import * as React from "react";
import Bus from "@/lib/bus";

import { Button } from "./Button";

export function Header() {
	const [menuOpen, setMenuOpen] = React.useState(false);
	const menuRef = React.useRef<HTMLDivElement | null>(null);

	const handleSearch = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
		}
	};

	const openSettings = React.useCallback(() => {
		Bus.emit("settings:open", undefined);
		setMenuOpen(false);
	}, []);

	React.useEffect(() => {
		if (!menuOpen) {
			return;
		}

		const handlePointerDown = (event: MouseEvent) => {
			if (menuRef.current?.contains(event.target as Node)) {
				return;
			}

			setMenuOpen(false);
		};

		window.addEventListener("mousedown", handlePointerDown);
		return () => {
			window.removeEventListener("mousedown", handlePointerDown);
		};
	}, [menuOpen]);

	const isElectron = typeof window !== "undefined" && "ipcRenderer" in window;
	const dragRegionClass = isElectron ? "electron-drag-region" : "";
	const noDragClass = isElectron ? "electron-no-drag" : "";

	return (
		<div
			className={`h-12 bg-panel flex items-center justify-between px-3 select-none pl-20 ${dragRegionClass}`}
		>
			<div className={`relative flex items-center gap-1 ${noDragClass}`}>
				<Button
					size="icon"
					variant="ghost"
					className="h-7 w-7"
					aria-label="Toggle sidebar"
					onClick={() => Bus.emit("sidebar:toggle", undefined)}
				>
					<SidebarIcon className="h-4 w-4" />
				</Button>
				<Button
					size="icon"
					variant="ghost"
					className="h-7 w-7"
					aria-label="Open menu"
					onClick={() => setMenuOpen((current) => !current)}
				>
					<Menu className="h-4 w-4" />
				</Button>
				{menuOpen ? (
					<div
						ref={menuRef}
						className="absolute left-0 top-9 z-50 min-w-[220px] rounded-xl border border-border-500 bg-panel-600 p-1 shadow-2xl"
					>
						<button
							type="button"
							onClick={openSettings}
							className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-foreground/85 transition-colors hover:bg-panel-500"
						>
							<span>Settings</span>
							<span className="text-xs uppercase tracking-[0.14em] text-foreground/40">
								Cmd+,
							</span>
						</button>
					</div>
				) : null}
			</div>

			<div className={`mx-4 max-w-md flex-1 ${noDragClass}`}>
				<div className="relative flex items-center rounded-full border border-border-500 bg-panel-600 px-1 focus-within:border-highlight focus-within:outline-none">
					<Search className="ml-1 h-4 w-4 text-foreground/50" />
					<input
						type="text"
						placeholder="Search..."
						className="h-8 w-full px-2 text-sm text-foreground outline-none placeholder:text-placeholder"
						onKeyDown={handleSearch}
					/>
					<div className="rounded-full border border-border-500 px-1.5 py-0.5 text-xs text-foreground/40">
						⌘K
					</div>
				</div>
			</div>

			<div className={`flex items-center gap-1 ${noDragClass}`}>
				<Button
					size="icon"
					variant="ghost"
					className="h-7 w-7"
					aria-label="Open flow viewer"
					onClick={() => (window as any).windowBridge?.openMermaidViewer()}
				>
					<Network className="h-4 w-4" />
				</Button>
				<Button
					size="icon"
					variant="ghost"
					className="h-7 w-7"
					aria-label="Open settings"
					onClick={openSettings}
				>
					<Settings className="h-4 w-4" />
				</Button>
				<Button size="icon" variant="ghost" className="h-7 w-7">
					<X className="h-4 w-4" />
				</Button>
			</div>
		</div>
	);
}
