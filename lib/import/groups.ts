/**
 * fork:import-ui — pure grouping / selection helpers for the import page.
 *
 * Kept out of the component so the behaviour that decides "what gets imported" is
 * testable without a DOM: which rows a group click selects, and whether the group's
 * checkbox reads checked, unchecked or indeterminate.
 */

import type { ImportCandidate, ImportSessionCandidate } from "./contract";

export type ImportGroupBy = "source" | "project";

export interface ImportGroup<T> {
  key: string;
  /** Source id or project path — the caller localises the display label. */
  rawLabel: string;
  items: T[];
  /** Newest timestamp seen in the group, for ordering. Empty when unknown. */
  latest: string;
}

/** Session candidates carry a project; the other kinds only have a source. */
export function groupsForKind(kind: ImportCandidate["kind"]): ImportGroupBy[] {
  return kind === "sessions" ? ["source", "project"] : ["source"];
}

function groupKeyOf(candidate: ImportCandidate, by: ImportGroupBy): string {
  if (by === "project") {
    const project = (candidate as ImportSessionCandidate).projectPath;
    return project && project.trim() ? project.trim() : "";
  }
  return candidate.source;
}

function sortKeyOf(candidate: ImportCandidate): string {
  if (candidate.kind !== "sessions") return "";
  return (candidate as ImportSessionCandidate).updatedAt ?? "";
}

/**
 * Group candidates for display.
 *
 * Groups are ordered newest-first by their newest item so an import list reads like a
 * feed; items inside a group keep the scan's own order (the scan already sorts newest
 * first). Sessions grouped by project put real projects before the "no project" bucket,
 * because a path-less session is the least actionable row on the page.
 */
export function groupCandidates(
  candidates: readonly ImportCandidate[],
  by: ImportGroupBy,
): ImportGroup<ImportCandidate>[] {
  const groups = new Map<string, ImportGroup<ImportCandidate>>();
  for (const candidate of candidates) {
    const key = groupKeyOf(candidate, by);
    let group = groups.get(key);
    if (!group) {
      group = { key, rawLabel: key, items: [], latest: "" };
      groups.set(key, group);
    }
    group.items.push(candidate);
    const sortKey = sortKeyOf(candidate);
    if (sortKey > group.latest) group.latest = sortKey;
  }

  const ordered = [...groups.values()].sort((a, b) => {
    if (by === "project") {
      // A known project beats "no project", then newest activity wins.
      if (Boolean(a.key) !== Boolean(b.key)) return a.key ? -1 : 1;
    }
    if (a.latest !== b.latest) return b.latest.localeCompare(a.latest);
    return a.key.localeCompare(b.key);
  });
  return ordered;
}

export function groupSelectionState(
  items: readonly ImportCandidate[],
  selected: ReadonlySet<string>,
): "all" | "none" | "some" {
  if (items.length === 0) return "none";
  let picked = 0;
  for (const item of items) if (selected.has(item.id)) picked++;
  if (picked === 0) return "none";
  return picked === items.length ? "all" : "some";
}

/** Toggle every id in one group, leaving other groups untouched. */
export function toggleGroupSelection(
  selected: ReadonlySet<string>,
  items: readonly ImportCandidate[],
): Set<string> {
  const next = new Set(selected);
  const state = groupSelectionState(items, selected);
  const shouldSelect = state !== "all";
  for (const item of items) {
    if (shouldSelect) next.add(item.id);
    else next.delete(item.id);
  }
  return next;
}

export function toggleAllSelection(
  selected: ReadonlySet<string>,
  candidates: readonly ImportCandidate[],
): Set<string> {
  const state = groupSelectionState(candidates, selected);
  if (state === "all") return new Set();
  return new Set(candidates.map((candidate) => candidate.id));
}

export interface ImportResultSummary {
  imported: number;
  skipped: number;
  failed: number;
}

export function summarizeResults(
  items: readonly { status: "imported" | "skipped" | "failed" }[],
): ImportResultSummary {
  const summary: ImportResultSummary = { imported: 0, skipped: 0, failed: 0 };
  for (const item of items) summary[item.status] += 1;
  return summary;
}
