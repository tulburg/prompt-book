import type { DiffHunk } from "./tool-types";

const CONTEXT_LINES = 3;

type Change =
	| { type: "eq"; oldIdx: number; newIdx: number }
	| { type: "del"; oldIdx: number }
	| { type: "add"; newIdx: number };

/**
 * Myers-style diff producing a list of change operations.
 * For very large inputs (>10k total lines), falls back to a
 * prefix/suffix matching approach that stays bounded in memory.
 */
function myersDiff(oldLines: string[], newLines: string[]): Change[] {
	const n = oldLines.length;
	const m = newLines.length;
	const max = n + m;
	const vSize = 2 * max + 1;

	if (max > 10_000) {
		return simpleDiff(oldLines, newLines);
	}

	const v = new Int32Array(vSize);
	v.fill(-1);
	const offset = max;
	v[offset + 1] = 0;

	const trace: Int32Array[] = [];

	outer:
	for (let d = 0; d <= max; d++) {
		const snap = new Int32Array(vSize);
		snap.set(v);
		trace.push(snap);

		for (let k = -d; k <= d; k += 2) {
			let x: number;
			if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
				x = v[offset + k + 1];
			} else {
				x = v[offset + k - 1] + 1;
			}
			let y = x - k;
			while (x < n && y < m && oldLines[x] === newLines[y]) {
				x++;
				y++;
			}
			v[offset + k] = x;
			if (x >= n && y >= m) {
				break outer;
			}
		}
	}

	const changes: Change[] = [];
	let x = n;
	let y = m;

	for (let d = trace.length - 1; d > 0; d--) {
		const prev = trace[d - 1]!;
		const k = x - y;

		let prevK: number;
		if (k === -d || (k !== d && prev[offset + k - 1] < prev[offset + k + 1])) {
			prevK = k + 1;
		} else {
			prevK = k - 1;
		}

		const prevX = prev[offset + prevK]!;
		const prevY = prevX - prevK;

		while (x > prevX && y > prevY) {
			x--;
			y--;
			changes.push({ type: "eq", oldIdx: x, newIdx: y });
		}

		if (d > 0) {
			if (x === prevX) {
				y--;
				changes.push({ type: "add", newIdx: y });
			} else {
				x--;
				changes.push({ type: "del", oldIdx: x });
			}
		}
	}

	while (x > 0 && y > 0) {
		x--;
		y--;
		changes.push({ type: "eq", oldIdx: x, newIdx: y });
	}
	while (x > 0) {
		x--;
		changes.push({ type: "del", oldIdx: x });
	}
	while (y > 0) {
		y--;
		changes.push({ type: "add", newIdx: y });
	}

	changes.reverse();
	return changes;
}

/**
 * Fallback diff for very large files: match common prefix and suffix,
 * treat everything in between as deletions then additions.
 */
function simpleDiff(oldLines: string[], newLines: string[]): Change[] {
	const changes: Change[] = [];
	let i = 0;
	let j = 0;

	while (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
		changes.push({ type: "eq", oldIdx: i, newIdx: j });
		i++;
		j++;
	}

	let oldEnd = oldLines.length - 1;
	let newEnd = newLines.length - 1;
	const suffixChanges: Change[] = [];
	while (oldEnd >= i && newEnd >= j && oldLines[oldEnd] === newLines[newEnd]) {
		suffixChanges.push({ type: "eq", oldIdx: oldEnd, newIdx: newEnd });
		oldEnd--;
		newEnd--;
	}

	while (i <= oldEnd) {
		changes.push({ type: "del", oldIdx: i });
		i++;
	}
	while (j <= newEnd) {
		changes.push({ type: "add", newIdx: j });
		j++;
	}

	suffixChanges.reverse();
	changes.push(...suffixChanges);
	return changes;
}

/**
 * Compute structured diff hunks with actual line content from an old/new string pair.
 * Lines are prefixed: " " context, "-" deletion, "+" addition.
 * Hunks include surrounding context (3 lines) and are merged when close together.
 */
export function computeContentDiffHunks(
	oldText: string,
	newText: string,
): { hunks: DiffHunk[]; additions: number; deletions: number } {
	const oldLines = oldText.split("\n");
	const newLines = newText.split("\n");
	const changes = myersDiff(oldLines, newLines);

	let additions = 0;
	let deletions = 0;
	for (const ch of changes) {
		if (ch.type === "add") additions++;
		if (ch.type === "del") deletions++;
	}

	const changeRanges: Array<{ start: number; end: number }> = [];
	let rangeStart: number | null = null;
	for (let i = 0; i < changes.length; i++) {
		if (changes[i]!.type !== "eq") {
			if (rangeStart === null) rangeStart = i;
		} else if (rangeStart !== null) {
			changeRanges.push({ start: rangeStart, end: i });
			rangeStart = null;
		}
	}
	if (rangeStart !== null) {
		changeRanges.push({ start: rangeStart, end: changes.length });
	}

	if (changeRanges.length === 0) {
		return { hunks: [], additions: 0, deletions: 0 };
	}

	const mergedRanges: Array<{ start: number; end: number }> = [changeRanges[0]!];
	for (let i = 1; i < changeRanges.length; i++) {
		const prev = mergedRanges[mergedRanges.length - 1]!;
		const curr = changeRanges[i]!;
		if (curr.start - prev.end <= 2 * CONTEXT_LINES) {
			prev.end = curr.end;
		} else {
			mergedRanges.push({ ...curr });
		}
	}

	const hunks: DiffHunk[] = [];

	for (const range of mergedRanges) {
		const ctxStart = Math.max(0, range.start - CONTEXT_LINES);
		const ctxEnd = Math.min(changes.length, range.end + CONTEXT_LINES);

		const hunkLines: string[] = [];
		let oldStart = Infinity;
		let newStart = Infinity;
		let oldCount = 0;
		let newCount = 0;

		for (let i = ctxStart; i < ctxEnd; i++) {
			const ch = changes[i]!;
			switch (ch.type) {
				case "eq":
					hunkLines.push(` ${oldLines[ch.oldIdx]}`);
					if (ch.oldIdx + 1 < oldStart || oldStart === Infinity) oldStart = ch.oldIdx + 1;
					if (ch.newIdx + 1 < newStart || newStart === Infinity) newStart = ch.newIdx + 1;
					oldCount++;
					newCount++;
					break;
				case "del":
					hunkLines.push(`-${oldLines[ch.oldIdx]}`);
					if (ch.oldIdx + 1 < oldStart || oldStart === Infinity) oldStart = ch.oldIdx + 1;
					oldCount++;
					break;
				case "add":
					hunkLines.push(`+${newLines[ch.newIdx]}`);
					if (ch.newIdx + 1 < newStart || newStart === Infinity) newStart = ch.newIdx + 1;
					newCount++;
					break;
			}
		}

		hunks.push({
			oldStart: oldStart === Infinity ? 1 : oldStart,
			oldLines: oldCount,
			newStart: newStart === Infinity ? 1 : newStart,
			newLines: newCount,
			lines: hunkLines,
		});
	}

	return { hunks, additions, deletions };
}
