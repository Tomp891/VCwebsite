/**
 * Pure query helpers for the "database = saved query over Block.props" idea.
 * No React here so the logic stays testable and reusable.
 */
import type { Block, PropValue } from "@atlas/contracts";

export type SortDir = "asc" | "desc";

export interface SortState {
  key: string;
  dir: SortDir;
}

/** Filter predicate applied to a block. */
export interface Filter {
  /** match blocks whose `tags` prop includes this tag (empty = any). */
  tag: string;
  /** which prop key to match a value against (empty = ignore). */
  propKey: string;
  /** substring match against the chosen prop's rendered value. */
  propValue: string;
  /** free-text search across content. */
  text: string;
}

export const EMPTY_FILTER: Filter = { tag: "", propKey: "", propValue: "", text: "" };

/** All prop keys present across the given blocks, in stable first-seen order. */
export function propKeys(blocks: Block[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    for (const k of Object.keys(b.props)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return keys;
}

/** Tags read off a block's `tags` prop (array-of-strings by convention). */
export function blockTags(block: Block): string[] {
  const raw = block.props.tags;
  return Array.isArray(raw) ? raw : [];
}

/** The full set of tags across blocks, sorted alphabetically. */
export function allTags(blocks: Block[]): string[] {
  const set = new Set<string>();
  for (const b of blocks) for (const t of blockTags(b)) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Human-readable rendering of a prop value. */
export function formatValue(value: PropValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** Comparable key for sorting; numbers sort numerically, everything else lexically. */
function sortKey(value: PropValue | undefined): number | string {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return formatValue(value).toLowerCase();
}

export function matchesFilter(block: Block, filter: Filter): boolean {
  if (filter.tag && !blockTags(block).includes(filter.tag)) return false;
  if (filter.text) {
    if (!block.content.toLowerCase().includes(filter.text.toLowerCase())) return false;
  }
  if (filter.propKey && filter.propValue) {
    const rendered = formatValue(block.props[filter.propKey]).toLowerCase();
    if (!rendered.includes(filter.propValue.toLowerCase())) return false;
  }
  return true;
}

export function applyFilter(blocks: Block[], filter: Filter): Block[] {
  return blocks.filter((b) => matchesFilter(b, filter));
}

export function applySort(blocks: Block[], sort: SortState | null): Block[] {
  if (!sort) return blocks;
  const out = [...blocks];
  out.sort((a, b) => {
    const ka = sort.key === "content" ? a.content.toLowerCase() : sortKey(a.props[sort.key]);
    const kb = sort.key === "content" ? b.content.toLowerCase() : sortKey(b.props[sort.key]);
    let cmp: number;
    if (typeof ka === "number" && typeof kb === "number") cmp = ka - kb;
    else cmp = String(ka).localeCompare(String(kb));
    return sort.dir === "asc" ? cmp : -cmp;
  });
  return out;
}

/** The value used to group a block by a given prop key ("" = no group key). */
export function groupValue(block: Block, groupKey: string): string {
  if (!groupKey) return "";
  if (groupKey === "tags") {
    const tags = blockTags(block);
    return tags.length ? tags[0] : "—";
  }
  const v = block.props[groupKey];
  const rendered = formatValue(v);
  return rendered === "" ? "—" : rendered;
}

export interface Group {
  key: string;
  blocks: Block[];
}

/** Group blocks by a prop key, preserving first-seen group order. */
export function groupBlocks(blocks: Block[], groupKey: string): Group[] {
  if (!groupKey) return [{ key: "", blocks }];
  const order: string[] = [];
  const map = new Map<string, Block[]>();
  for (const b of blocks) {
    const g = groupValue(b, groupKey);
    if (!map.has(g)) {
      map.set(g, []);
      order.push(g);
    }
    map.get(g)!.push(b);
  }
  return order.map((key) => ({ key, blocks: map.get(key)! }));
}
