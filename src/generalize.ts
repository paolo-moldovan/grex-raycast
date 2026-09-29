export interface Candidate {
  label: string;
  /** The regex that is tested against the examples. */
  regex: string;
  /** Shown and copied instead of `regex` when set (grex --verbose output). */
  display?: string;
  /** The grex command that produced this candidate, if any. */
  command?: string;
}

export interface ScoredCandidate extends Candidate {
  posMatched: boolean[];
  negMatched: boolean[];
  tp: number;
  fp: number;
  perfect: boolean;
  error?: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const chars = (s: string) => Array.from(s);
const isWordChar = (c: string) => /[\p{L}\p{N}]/u.test(c);

function commonPrefix(xs: string[]): string {
  let p = chars(xs[0]);
  for (const x of xs.slice(1)) {
    const c = chars(x);
    let i = 0;
    while (i < p.length && i < c.length && p[i] === c[i]) i++;
    p = p.slice(0, i);
  }
  return p.join("");
}

function commonSuffix(xs: string[]): string {
  const rev = (s: string) => chars(s).reverse().join("");
  return rev(commonPrefix(xs.map(rev)));
}

/** Narrowest shorthand class that covers every character in `parts`. */
function charClass(parts: string[]): string {
  const all = parts.join("");
  if (/^\d*$/.test(all)) return "\\d";
  if (/^\w*$/.test(all)) return "\\w";
  if (/^\S*$/.test(all)) return "\\S";
  return ".";
}

function lengthRange(parts: string[]): string {
  const lens = parts.map((p) => chars(p).length);
  const min = Math.min(...lens);
  const max = Math.max(...lens);
  return min === max ? `{${min}}` : `{${min},${max}}`;
}

const repeat = (parts: string[]) => (parts.some((p) => p === "") ? "*" : "+");

/** Shorter versions of a literal prefix, cut right after a separator (val/raw_ → val/ → ""). */
function prefixCuts(p: string): string[] {
  const c = chars(p);
  const out: string[] = [];
  for (let i = c.length; i >= 0; i--) {
    if (i === 0 || i === c.length || !isWordChar(c[i - 1]))
      out.push(c.slice(0, i).join(""));
  }
  return out;
}

/** Shorter versions of a literal suffix, cut right before a separator (_loss → ""). */
function suffixCuts(s: string): string[] {
  const c = chars(s);
  const out: string[] = [];
  for (let j = 0; j <= c.length; j++) {
    if (j === 0 || j === c.length || !isWordChar(c[j]))
      out.push(c.slice(j).join(""));
  }
  return out;
}

/**
 * Builds progressively looser regexes from the positive examples, tightest first:
 * loosen the part between the shared start and end, then shorten that shared start and end.
 */
export function generalize(positives: string[]): Candidate[] {
  const out: Candidate[] = [];
  const P = commonPrefix(positives);
  const S = commonSuffix(
    positives.map((x) => chars(x).slice(chars(P).length).join("")),
  );
  const mids = positives.map((x) => {
    const c = chars(x);
    return c.slice(chars(P).length, c.length - chars(S).length).join("");
  });
  const wrap = (mid: string) => `^${escape(P)}${mid}${escape(S)}$`;

  if (mids.some((m) => m !== "")) {
    const cls = charClass(mids);

    const heads = mids.map((m) => /^[\p{L}\p{N}]+/u.exec(m)?.[0] ?? "");
    const tails = mids.map((m, i) => m.slice(heads[i].length));
    const uniqueHeads = [...new Set(heads)].sort();
    if (
      heads.every((h) => h) &&
      uniqueHeads.length < positives.length &&
      tails.some((t) => t)
    ) {
      out.push({
        label: "Keep first word of the middle",
        regex: wrap(
          `(?:${uniqueHeads.map(escape).join("|")})${charClass(tails)}${repeat(tails)}`,
        ),
      });
    }
    out.push({
      label: "Character class, length range",
      regex: wrap(cls + lengthRange(mids)),
    });
    out.push({
      label: "Character class, any length",
      regex: wrap(cls + repeat(mids)),
    });
    if (cls !== ".")
      out.push({
        label: "Anything in the middle",
        regex: wrap("." + repeat(mids)),
      });
  }

  const pairs: [string, string][] = [];
  for (const p of prefixCuts(P)) {
    for (const s of suffixCuts(S)) {
      if ((p === P && s === S) || (!p && !s)) continue;
      pairs.push([p, s]);
    }
  }
  pairs.sort((a, b) => chars(b[0] + b[1]).length - chars(a[0] + a[1]).length);
  for (const [p, s] of pairs) {
    const gap = positives.every((x) => chars(x).length > chars(p + s).length)
      ? ".+"
      : ".*";
    const regex =
      p && s
        ? `^${escape(p)}${gap}${escape(s)}$`
        : p
          ? `^${escape(p)}`
          : `${escape(s)}$`;
    const label =
      p && s
        ? `Keep "${p}" … "${s}"`
        : p
          ? `Starts with "${p}"`
          : `Ends with "${s}"`;
    out.push({ label, regex });
  }
  return out;
}

/** Compiles a grex or generated regex for testing; grex puts flags in a leading (?i) group. */
export function compile(regex: string, ignoreCase: boolean): RegExp {
  let source = regex;
  let flags = ignoreCase ? "i" : "";
  const inline = /^\(\?([a-z]+)\)/.exec(source);
  if (inline) {
    if (inline[1].includes("i")) flags = "i";
    source = source.slice(inline[0].length);
  }
  try {
    return new RegExp(source, flags + "u");
  } catch {
    return new RegExp(source, flags);
  }
}

export function score(
  candidates: Candidate[],
  positives: string[],
  negatives: string[],
  ignoreCase: boolean,
): ScoredCandidate[] {
  const seen = new Set<string>();
  return candidates
    .filter((c) => !seen.has(c.regex) && seen.add(c.regex))
    .map((c) => {
      try {
        const re = compile(c.regex, ignoreCase);
        const posMatched = positives.map((x) => re.test(x));
        const negMatched = negatives.map((x) => re.test(x));
        const tp = posMatched.filter(Boolean).length;
        const fp = negMatched.filter(Boolean).length;
        return {
          ...c,
          posMatched,
          negMatched,
          tp,
          fp,
          perfect: tp === positives.length && fp === 0,
        };
      } catch (e) {
        return {
          ...c,
          posMatched: positives.map(() => false),
          negMatched: negatives.map(() => false),
          tp: 0,
          fp: 0,
          perfect: false,
          error: (e as Error).message,
        };
      }
    });
}

/** Index of the loosest candidate that matches every positive and no negative. */
export function recommended(scored: ScoredCandidate[]): number {
  for (let i = scored.length - 1; i >= 0; i--) if (scored[i].perfect) return i;
  return 0;
}

/** Splits examples into groups that share a start (through the first separator) or an end. */
function partition(
  positives: string[],
): { key: string; items: string[] }[] | undefined {
  const byPrefix = (x: string) => {
    const c = chars(x);
    const i = c.findIndex((ch) => !isWordChar(ch));
    return i < 0 ? x : c.slice(0, i + 1).join("");
  };
  const bySuffix = (x: string) => {
    const c = chars(x);
    let i = c.length - 1;
    while (i >= 0 && isWordChar(c[i])) i--;
    return i < 0 ? x : c.slice(i).join("");
  };
  let best: { key: string; items: string[] }[] | undefined;
  for (const keyOf of [byPrefix, bySuffix]) {
    const groups = new Map<string, string[]>();
    for (const x of positives)
      groups.set(keyOf(x), [...(groups.get(keyOf(x)) ?? []), x]);
    const list = [...groups].map(([key, items]) => ({ key, items }));
    // Useful only when it actually splits the examples and some group has several members.
    if (list.length < 2 || list.length === positives.length) continue;
    if (!best || list.length < best.length) best = list;
  }
  return best;
}

const bothAnchored = (r: string) =>
  r.startsWith("^") && r.endsWith("$") && !r.endsWith("\\$");

/**
 * For examples with no single shared start and end (`val/a_loss`, `train/b_err`), loosens each
 * group on its own and joins the groups as alternatives: ^(?:val/\w+_loss|train/\w+_err)$.
 */
export function generalizeGroups(positives: string[]): Candidate[] {
  const groups = partition(positives);
  if (!groups) return [];
  const ladders = groups.map(({ items }) => {
    const exact = items.map(escape).join("|");
    const steps = generalize(items)
      .map((c) => c.regex)
      .filter(bothAnchored)
      .map((r) => r.slice(1, -1));
    return [items.length > 1 ? `(?:${exact})` : exact, ...steps];
  });
  const depth = Math.max(...ladders.map((l) => l.length));
  const out: Candidate[] = [];
  for (let k = 1; k < depth; k++) {
    const alternatives = ladders.map((l) => l[Math.min(k, l.length - 1)]);
    out.push({
      label: `${groups.length} groups (${groups.map((g) => g.key).join(" ")}), step ${k}`,
      regex: `^(?:${alternatives.join("|")})$`,
    });
  }
  return out;
}
