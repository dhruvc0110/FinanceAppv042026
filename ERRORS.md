# FinApp — Things That Didn't Work

Check before suggesting approaches to similar tasks. Each entry: what didn't work / what worked / note.

---

## Edit tool: match failure on lines with literal `…` and unicode box-drawing chars

**What didn't work:** Trying to replace a multi-line block in `index.html` whose `old_string` included:
- A comment header like `// ── Anthropic API call ────────────────────────────────────────` (uses U+2500 box-drawing chars, count of dashes matters)
- A status string `'<span class="text-slate-400">&#x23F3; Interpreting…</span>'` where the source actually contains the six literal characters `…` (backslash, u, 2, 0, 2, 6), not the ellipsis character U+2026 itself

The Edit tool auto-swaps `\uXXXX` escapes ↔ the character form when matching, but it doesn't auto-swap box-drawing characters, and the combination of both mismatches in one block caused the swap-recovery to fail.

**What worked:** Drop the comment-header line from `old_string` entirely. Anchor the match at `async function _dtProcessText(text, onComplete) {` (or any other line without unicode runs). The function body itself was unambiguous.

**Note for next time:** When editing this codebase, comment-headers with unicode dashes are unreliable anchors for Edit matching. Match from the function signature or a plain ASCII line. Also: if you see `…` or similar in a Read output, that's how it actually exists in the source — `cat -A` or `xxd` confirms.

---
