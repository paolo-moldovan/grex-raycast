# Grex

Generate regular expressions from examples with [grex](https://github.com/pemistahl/grex), then pick how tight or loose the result should be.

## Requirements

This extension runs the `grex` command-line tool, which must be installed separately:

```bash
brew install grex
```

Or with Cargo: `cargo install grex`. The extension looks for `grex` in `/opt/homebrew/bin`, `/usr/local/bin` and `~/.cargo/bin`. If it lives elsewhere, set **Grex Binary** in the extension preferences.

## Usage

1. Open **Generate Regex**.
2. Enter lines that the regex should match in **Should Match**.
3. Optionally enter lines it must not match in **Should Not Match**.
4. Press ⌘↵.

The result is a list of tightness levels, from grex's exact regex down to looser generalizations:

| Level | Example |
| --- | --- |
| grex exact | `^val/raw_(?:delta_velocity_(?:quantil\|ms)e_loss\|…)$` |
| Character class, length range | `^val/raw_\w{8,23}_loss$` |
| Anything in the middle | `^val/raw_.+_loss$` |
| Shorter shared start and end | `^val/.+_loss$` |

When the examples don't share one start and end (`val/a_loss`, `train/b_err`), they are split into groups by their start or end. Each group is loosened separately and the groups are joined with `|`, for example `^(?:val/\w+_loss|train/\w+_err)$`.

Every level is tested against your examples:

- ⭐ The loosest level that matches every **Should Match** line and no **Should Not Match** line. It is selected by default.
- ✅ Matches everything it should, no false positives.
- ❌ Matches at least one line it should not.
- ⚠️ Misses at least one line it should match.

The detail panel shows each example and whether it matched.

### Input from a file

**Add From File** reads one example per line. If every line starts with `+` or `-`, `+` lines are treated as Should Match and `-` lines as Should Not Match.

### grex options

All grex options are available in the form: digits, whitespace and word character classes, unicode escaping, repetition detection, anchors, verbose mode, colorized output, case-insensitive matching and capture groups. They apply to the grex levels; the generalized levels are built from your examples directly.

## Actions

| Action | Shortcut |
| --- | --- |
| Copy Regex | ↵ |
| Paste Regex | ⌘↵ |
| Copy as /Regex/ Literal | ⌘⇧L |
| Copy Grex Command | ⌘⇧C |
| Edit Options | ⌘E |
