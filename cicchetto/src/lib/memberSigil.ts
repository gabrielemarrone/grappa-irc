// Returns the rendered prefix sigil for a member, given their mode list and
// the network's advertised sigil rank: the HIGHEST-ranked sigil they hold,
// or " " (single space) for plain — the space keeps columns aligned with
// sigil-bearing siblings in monospace rendering.
//
// Lifted from `ScrollbackPane.tsx`'s former module-private `memberSigil`
// helper so the same sigil derivation is reused by MembersPane (right
// pane) AND ScrollbackPane (sender prefix in scrollback rows). Per
// CLAUDE.md "implement once, reuse everywhere".
//
// issue 1999 — `rank` used to be a hardcoded `@ > % > +` ladder inside this
// function. Once the server stopped gluing sigils to nicks (see
// `Grappa.Session.ISupport.sigils/1`, which drives the 353 peel), a
// founder's `["~"]` matched none of the three branches and fell through to
// the plain arm: drawn with no sigil, indistinguishable from a lurker. The
// rank is now the network's own, from `sigilRank`/`sigilRankForNetwork`,
// and it is a PARAMETER rather than a store read so this stays a pure
// function with no edge to the solid-js resource graph (same shape as
// `editorSigils`, which takes the whole entry).
//
// Rank is the RUN's, never the modes array's: a member accumulates sigils
// in whatever order MODE lines arrived, so their position carries no rank.
// A sigil the network never advertised is NOT a grade — the member reads as
// plain rather than being handed an invented glyph, the same posture
// `membershipLevelName` takes for an unadvertised sigil.
//
// IMPORTANT: this is the DOM-text representation. The previous
// MembersPane implementation rendered the prefix via CSS `::before
// { content: ... }`, which read fine visually but was invisible to
// `textContent` and got clipped when paired with a `width: 100%`
// block-level click button (Spec #5). See memory
// `feedback_css_block_button_wraps_inline_prefix` for the regression
// post-mortem.

export const memberSigil = (modes: readonly string[], rank: readonly string[]): string =>
  rank.find((sigil) => modes.includes(sigil)) ?? " ";
