export interface NativeContextMenuActionItem {
	type: "action";
	id: string;
	label: string;
	accelerator?: string;
	enabled?: boolean;
}

export interface NativeContextMenuSeparatorItem {
	type: "separator";
}

export type NativeContextMenuItem =
	| NativeContextMenuActionItem
	| NativeContextMenuSeparatorItem;

export interface NativeContextMenuRequest {
	items: NativeContextMenuItem[];
	x?: number;
	y?: number;
}

export interface NativeContextMenuBridge {
	showMenu: (request: NativeContextMenuRequest) => Promise<string | null>;
}
