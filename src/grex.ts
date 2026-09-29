import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";

export type Anchors = "both" | "no-start" | "no-end" | "none";

export interface GrexOptions {
  testCases: string;
  negatives: string;
  file?: string;
  digits: boolean;
  nonDigits: boolean;
  spaces: boolean;
  nonSpaces: boolean;
  words: boolean;
  nonWords: boolean;
  escape: boolean;
  withSurrogates: boolean;
  repetitions: boolean;
  minRepetitions: string;
  minSubstringLength: string;
  anchors: Anchors;
  verbose: boolean;
  colorize: boolean;
  ignoreCase: boolean;
  captureGroups: boolean;
}

export const DEFAULT_OPTIONS: GrexOptions = {
  testCases: "",
  negatives: "",
  digits: false,
  nonDigits: false,
  spaces: false,
  nonSpaces: false,
  words: false,
  nonWords: false,
  escape: false,
  withSurrogates: false,
  repetitions: false,
  minRepetitions: "1",
  minSubstringLength: "1",
  anchors: "both",
  verbose: false,
  colorize: false,
  ignoreCase: false,
  captureGroups: false,
};

const CANDIDATES = [
  "/opt/homebrew/bin/grex",
  "/usr/local/bin/grex",
  join(homedir(), ".cargo/bin/grex"),
];

export function resolveGrexPath(preference?: string): string {
  if (preference && preference.trim()) return preference.trim();
  return CANDIDATES.find((p) => existsSync(p)) ?? "grex";
}

export function buildArgs(o: GrexOptions): string[] {
  const args: string[] = [];
  const flag = (on: boolean, name: string) => on && args.push(name);
  flag(o.digits, "--digits");
  flag(o.nonDigits, "--non-digits");
  flag(o.spaces, "--spaces");
  flag(o.nonSpaces, "--non-spaces");
  flag(o.words, "--words");
  flag(o.nonWords, "--non-words");
  flag(o.escape, "--escape");
  flag(o.escape && o.withSurrogates, "--with-surrogates");
  flag(o.repetitions, "--repetitions");
  if (o.repetitions) {
    if (o.minRepetitions.trim())
      args.push("--min-repetitions", o.minRepetitions.trim());
    if (o.minSubstringLength.trim())
      args.push("--min-substring-length", o.minSubstringLength.trim());
  }
  flag(o.anchors === "no-start", "--no-start-anchor");
  flag(o.anchors === "no-end", "--no-end-anchor");
  flag(o.anchors === "none", "--no-anchors");
  flag(o.verbose, "--verbose");
  flag(o.colorize, "--colorize");
  flag(o.ignoreCase, "--ignore-case");
  flag(o.captureGroups, "--capture-groups");
  return args;
}

// eslint-disable-next-line no-control-regex
export const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

const lines = (text: string) =>
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => l !== "");

/**
 * Collects positive and negative examples from the form. File lines prefixed with "+" or "-"
 * are split into positives and negatives; otherwise every file line is a positive.
 */
export async function loadCases(
  o: GrexOptions,
): Promise<{ positives: string[]; negatives: string[] }> {
  const positives = lines(o.testCases);
  const negatives = lines(o.negatives);
  if (o.file) {
    const fileLines = lines(await readFile(o.file, "utf8"));
    if (fileLines.every((l) => l.startsWith("+") || l.startsWith("-"))) {
      for (const l of fileLines)
        (l.startsWith("+") ? positives : negatives).push(l.slice(1));
    } else positives.push(...fileLines);
  }
  return { positives, negatives };
}

const shellQuote = (a: string) =>
  /^[\w./=-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`;

export async function runGrex(
  cases: string[],
  o: GrexOptions,
  binary: string,
): Promise<{ command: string; output: string }> {
  const args = buildArgs(o);
  // A temp file (instead of argv) keeps test cases starting with "-" or containing spaces intact.
  const dir = await mkdtemp(join(tmpdir(), "grex-"));
  try {
    const file = join(dir, "cases.txt");
    await writeFile(file, cases.join("\n"), "utf8");
    const command = `grex ${[...args, "--", ...cases].map(shellQuote).join(" ")}`;
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        binary,
        [...args, "--file", file],
        { maxBuffer: 64 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            const e = err as NodeJS.ErrnoException;
            if (e.code === "ENOENT") {
              reject(
                new Error(
                  `grex not found at "${binary}". Install it with "brew install grex" or set the path in preferences.`,
                ),
              );
            } else {
              reject(new Error(stderr.trim() || err.message));
            }
          } else resolve(stdout);
        },
      );
    });
    return { command, output: stripAnsi(output).replace(/\n$/, "") };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
