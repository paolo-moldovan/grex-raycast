import {
  Action,
  ActionPanel,
  Clipboard,
  Color,
  List,
  Form,
  Icon,
  getPreferenceValues,
  showHUD,
  showToast,
  Toast,
  useNavigation,
  closeMainWindow,
  popToRoot,
  Keyboard,
} from "@raycast/api";
import { useEffect, useState } from "react";
import {
  Candidate,
  generalize,
  generalizeGroups,
  recommended,
  score,
  ScoredCandidate,
} from "./generalize";
import {
  Anchors,
  DEFAULT_OPTIONS,
  GrexOptions,
  loadCases,
  resolveGrexPath,
  runGrex,
} from "./grex";

interface Preferences {
  grexPath?: string;
}

const isPositiveInt = (s: string) =>
  s.trim() === "" || /^[1-9]\d*$/.test(s.trim());

const fence = (s: string) => "```\n" + s + "\n```";
const toLiteral = (regex: string, ignoreCase: boolean) =>
  `/${regex.replace(/(?<!\\)\//g, "\\/")}/${ignoreCase ? "i" : ""}`;

function detailMarkdown(
  c: ScoredCandidate,
  positives: string[],
  negatives: string[],
  isRecommended: boolean,
): string {
  const LIMIT = 200;
  const row = (text: string, ok: boolean) =>
    `- ${ok ? "✅" : "❌"} \`${text.replace(/`/g, "ˋ")}\``;
  const section = (rows: string[]) =>
    rows.slice(0, LIMIT).join("\n") +
    (rows.length > LIMIT ? `\n- … ${rows.length - LIMIT} more` : "");
  const parts = [
    `### ${isRecommended ? "⭐ " : ""}${c.label}`,
    fence(c.display ?? c.regex),
  ];
  if (c.error) parts.push(`**Invalid regex:** ${c.error}`);
  parts.push(
    `**Should match** — ${c.tp}/${positives.length} matched`,
    section(positives.map((x, i) => row(x, c.posMatched[i]))),
  );
  if (negatives.length) {
    parts.push(
      `**Should not match** — ${c.fp} false positive${c.fp === 1 ? "" : "s"}`,
      section(negatives.map((x, i) => row(x, !c.negMatched[i]))),
    );
  } else {
    parts.push(
      "_Add **Should Not Match** lines so the ⭐ level is the loosest regex that stays safe._",
    );
  }
  return parts.join("\n\n");
}

function Levels({
  options,
  onEdit,
}: {
  options: GrexOptions;
  onEdit: () => void;
}) {
  const [state, setState] = useState<{
    loading: boolean;
    levels?: ScoredCandidate[];
    best?: number;
    positives?: string[];
    negatives?: string[];
    error?: string;
  }>({ loading: true });

  useEffect(() => {
    (async () => {
      const { positives, negatives } = await loadCases(options);
      if (!positives.length)
        throw new Error("No positive test cases found (Should Match or file).");
      const binary = resolveGrexPath(
        getPreferenceValues<Preferences>().grexPath,
      );
      // Test grex output without the display-only flags; show the verbose form separately.
      const testable = { ...options, verbose: false, colorize: false };
      const exact = await runGrex(positives, testable, binary);
      const candidates: Candidate[] = [
        {
          label: "grex (exact)",
          regex: exact.output,
          command: exact.command,
        },
      ];
      if (options.verbose || options.colorize) {
        const shown = await runGrex(positives, options, binary);
        candidates[0].display = shown.output;
        candidates[0].command = shown.command;
      }
      if (!options.repetitions) {
        const rep = await runGrex(
          positives,
          { ...testable, repetitions: true },
          binary,
        );
        candidates.push({
          label: "grex --repetitions",
          regex: rep.output,
          command: rep.command,
        });
      }
      candidates.push(...generalizeGroups(positives), ...generalize(positives));
      const levels = score(
        candidates,
        positives,
        negatives,
        options.ignoreCase,
      );
      setState({
        loading: false,
        levels,
        best: recommended(levels),
        positives,
        negatives,
      });
    })().catch((e: Error) => setState({ loading: false, error: e.message }));
  }, []);

  const {
    levels,
    best,
    positives = [],
    negatives = [],
    error,
    loading,
  } = state;

  return (
    <List
      isLoading={loading}
      isShowingDetail={!!levels}
      navigationTitle="Tightness Levels"
      selectedItemId={best !== undefined ? String(best) : undefined}
    >
      {error && (
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="grex failed"
          description={error}
          actions={
            <ActionPanel>
              <Action
                title="Edit Options"
                icon={Icon.Pencil}
                onAction={onEdit}
              />
            </ActionPanel>
          }
        />
      )}
      {levels?.map((c, i) => {
        const text = c.display ?? c.regex;
        const icon =
          i === best && c.perfect
            ? { source: Icon.Star, tintColor: Color.Yellow }
            : c.perfect
              ? { source: Icon.CheckCircle, tintColor: Color.Green }
              : c.fp > 0
                ? { source: Icon.XMarkCircle, tintColor: Color.Red }
                : { source: Icon.Warning, tintColor: Color.Orange };
        return (
          <List.Item
            key={c.regex}
            id={String(i)}
            icon={icon}
            title={`${i}. ${c.regex}`}
            keywords={[c.label]}
            detail={
              <List.Item.Detail
                markdown={detailMarkdown(c, positives, negatives, i === best)}
              />
            }
            actions={
              <ActionPanel>
                <Action.CopyToClipboard title="Copy Regex" content={text} />
                <Action
                  title="Paste Regex"
                  icon={Icon.Clipboard}
                  shortcut={{ modifiers: ["cmd"], key: "return" }}
                  onAction={async () => {
                    await Clipboard.paste(text);
                    await closeMainWindow();
                    await popToRoot();
                  }}
                />
                <Action.CopyToClipboard
                  title="Copy as /Regex/ Literal"
                  content={toLiteral(c.regex, options.ignoreCase)}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "l" }}
                />
                {c.command && (
                  <Action.CopyToClipboard
                    title="Copy Grex Command"
                    content={c.command}
                    shortcut={Keyboard.Shortcut.Common.Copy}
                  />
                )}
                <Action
                  title="Edit Options"
                  icon={Icon.Pencil}
                  shortcut={Keyboard.Shortcut.Common.Edit}
                  onAction={onEdit}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

export default function Command() {
  const { push, pop } = useNavigation();
  const [o, setO] = useState<GrexOptions>(DEFAULT_OPTIONS);
  const [errors, setErrors] = useState<
    Partial<
      Record<"testCases" | "minRepetitions" | "minSubstringLength", string>
    >
  >({});

  const set = <K extends keyof GrexOptions>(k: K, v: GrexOptions[K]) =>
    setO((prev) => ({ ...prev, [k]: v }));
  const check = (k: keyof GrexOptions) => ({
    id: k,
    value: o[k] as boolean,
    onChange: (v: boolean) => set(k, v as never),
  });

  function submit() {
    const next: typeof errors = {};
    if (!o.file && !o.testCases.trim())
      next.testCases = "Enter at least one line to match or choose a file";
    if (o.repetitions && !isPositiveInt(o.minRepetitions))
      next.minRepetitions = "Must be a positive integer";
    if (o.repetitions && !isPositiveInt(o.minSubstringLength))
      next.minSubstringLength = "Must be a positive integer";
    setErrors(next);
    if (Object.keys(next).length) {
      showToast({
        style: Toast.Style.Failure,
        title: "Fix the highlighted fields",
      });
      return;
    }
    push(<Levels options={o} onEdit={pop} />);
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Generate Regex"
            icon={Icon.Wand}
            onSubmit={submit}
          />
          <Action
            title="Reset Options"
            icon={Icon.ArrowCounterClockwise}
            shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
            onAction={() => {
              setO(DEFAULT_OPTIONS);
              setErrors({});
              showHUD("Options reset");
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="testCases"
        title="Should Match"
        placeholder={
          "One example per line\nval/raw_traj_ate_loss\nval/raw_delta_velocity_mse_loss"
        }
        value={o.testCases}
        error={errors.testCases}
        onChange={(v) => {
          set("testCases", v);
          setErrors((e) => ({ ...e, testCases: undefined }));
        }}
        enableMarkdown={false}
      />
      <Form.TextArea
        id="negatives"
        title="Should Not Match"
        placeholder={
          "Optional. One example per line\nval/lr\ntrain/raw_traj_ate_loss"
        }
        info="Used to pick the loosest regex with no false positives. grex itself only sees the lines above."
        value={o.negatives}
        onChange={(v) => set("negatives", v)}
        enableMarkdown={false}
      />
      <Form.FilePicker
        id="file"
        title="Add From File"
        info="One example per line, added to the lines above. If every line starts with + or -, + lines should match and - lines should not."
        allowMultipleSelection={false}
        canChooseDirectories={false}
        value={o.file ? [o.file] : []}
        onChange={(v) => {
          set("file", v[0]);
          setErrors((e) => ({ ...e, testCases: undefined }));
        }}
      />

      <Form.Separator />
      <Form.Description
        title="Character Classes"
        text="Digits, whitespace and word characters"
      />
      <Form.Checkbox
        {...check("digits")}
        title="Digits"
        label="Convert to \d (--digits)"
      />
      <Form.Checkbox
        {...check("nonDigits")}
        label="Convert non-digits to \D (--non-digits)"
      />
      <Form.Checkbox
        {...check("spaces")}
        title="Whitespace"
        label="Convert to \s (--spaces)"
      />
      <Form.Checkbox
        {...check("nonSpaces")}
        label="Convert non-whitespace to \S (--non-spaces)"
      />
      <Form.Checkbox
        {...check("words")}
        title="Word Characters"
        label="Convert to \w (--words)"
      />
      <Form.Checkbox
        {...check("nonWords")}
        label="Convert non-word characters to \W (--non-words)"
      />

      <Form.Separator />
      <Form.Checkbox
        {...check("escape")}
        title="Escaping"
        label="Escape non-ASCII as unicode (--escape)"
      />
      <Form.Checkbox
        {...check("withSurrogates")}
        label="Use surrogate pairs for astral code points (--with-surrogates)"
        info="Only applies when escaping is enabled"
      />

      <Form.Separator />
      <Form.Checkbox
        {...check("repetitions")}
        title="Repetitions"
        label="Detect repeated substrings as {min,max} (--repetitions)"
      />
      {o.repetitions && (
        <>
          <Form.TextField
            id="minRepetitions"
            title="Min Repetitions"
            info="--min-repetitions (default 1)"
            value={o.minRepetitions}
            error={errors.minRepetitions}
            onChange={(v) => {
              set("minRepetitions", v);
              setErrors((e) => ({ ...e, minRepetitions: undefined }));
            }}
          />
          <Form.TextField
            id="minSubstringLength"
            title="Min Substring Length"
            info="--min-substring-length (default 1)"
            value={o.minSubstringLength}
            error={errors.minSubstringLength}
            onChange={(v) => {
              set("minSubstringLength", v);
              setErrors((e) => ({ ...e, minSubstringLength: undefined }));
            }}
          />
        </>
      )}

      <Form.Separator />
      <Form.Dropdown
        id="anchors"
        title="Anchors"
        value={o.anchors}
        onChange={(v) => set("anchors", v as Anchors)}
      >
        <Form.Dropdown.Item value="both" title="Start and end (default)" />
        <Form.Dropdown.Item
          value="no-start"
          title="No start anchor (--no-start-anchor)"
        />
        <Form.Dropdown.Item
          value="no-end"
          title="No end anchor (--no-end-anchor)"
        />
        <Form.Dropdown.Item value="none" title="No anchors (--no-anchors)" />
      </Form.Dropdown>

      <Form.Separator />
      <Form.Checkbox
        {...check("verbose")}
        title="Display"
        label="Verbose mode (--verbose)"
      />
      <Form.Checkbox
        {...check("colorize")}
        label="Colorize (--colorize)"
        info="grex emits ANSI colors; they are stripped from the displayed and copied result"
      />
      <Form.Checkbox
        {...check("ignoreCase")}
        title="Miscellaneous"
        label="Ignore case (--ignore-case)"
      />
      <Form.Checkbox
        {...check("captureGroups")}
        label="Use capturing groups (--capture-groups)"
      />
    </Form>
  );
}
