// #1929 — the DICTATED half of the credits' first block: the cow and the
// special thanks.
//
// Both are content rather than behaviour, and both were handed down rather
// than derived, so this module is data with one small function in it. It is a
// module and not JSX because content that someone else wrote should be
// testable without rendering a modal — see `creditsBlock.test.ts`, where the
// list is pinned against the issue and the cow against the ircd it came from.
//
// Sibling of `creditsProse.ts`, which owns the paragraph sets that run AFTER
// this block. The split is the block boundary itself: what is here is shown
// once, on the first pass; what is there is shown on every pass afterwards.

/** One line of the special thanks: who, and what for. */
export type SpecialThanks = {
  readonly who: string;
  readonly why: string;
};

/**
 * The cow's body, transcribed verbatim from Azzurra's bahamut —
 * `azzurra/bahamut src/version.c.SH:148-152`, the `/info` infotext whose
 * balloon reads "This bahamut has Super Cow Powers !".
 *
 * REUSED, not redrawn. The whole reason to put a cow here is that it is the
 * cow Azzurra's `/info` has been printing for twenty years; an ASCII animal
 * that merely resembles it would be a different joke told to nobody.
 *
 * The source is a shell heredoc generating C, so every backslash is written
 * there as four — two collapses later, this is what reaches a terminal.
 * `String.raw` keeps the escapes looking like what they are.
 */
const COW_BODY = String.raw`        \   ^__^
         \  (oo)\_______
            (__)\       )\/\
                ||----w |
                ||     ||`;

/**
 * What our cow says. bahamut's sentence with bahamut's name taken out of it —
 * the issue asks for the ASCII verbatim "with the text changed to speak for
 * grappa instead", and the smallest change that does that is the name.
 */
const COW_SAYS = "This grappa has Super Cow Powers !";

/**
 * A cowsay balloon around ONE line, in bahamut's exact geometry: a
 * space-flanked rule, the text between `< ` and ` >`, another rule.
 *
 * Built rather than transcribed so the rules can never disagree with the
 * sentence — the failure mode of a hand-drawn box is that someone edits the
 * words and the underscores stay the old length. Fed bahamut's own sentence
 * it reproduces bahamut's own balloon byte-for-byte, which is what
 * `creditsBlock.test.ts` checks before trusting it with ours.
 *
 * ONE line only. Real cowsay wraps at 40 columns and grows the balloon into a
 * multi-line box with `/` and `\` shoulders; nothing here says a sentence
 * that long, and half a wrapping implementation is worse than none.
 *
 * @param said the single line the cow speaks
 */
export function cowSaying(said: string): string {
  const rule = (fill: string): string => ` ${fill.repeat(said.length + 2)} `;
  return [rule("_"), `< ${said} >`, rule("-"), COW_BODY].join("\n");
}

/** The cow as it is rendered in the credits, balloon and all. */
export const CREDITS_COW: string = cowSaying(COW_SAYS);

/**
 * The special thanks, exactly as vjt dictated them on issue 1929.
 *
 * 🔴 COPIED VERBATIM. Nothing here is ours to improve: no name added, none
 * removed, no wording tightened, no "tidier" order. **Sonic is thanked twice
 * on purpose** — once among the people keeping Azzurra standing and once for
 * bicchierino — and deduplicating him would be editing someone else's words.
 * The test pins the whole list against the issue for exactly that reason.
 *
 * `who` and `why` are separate fields rather than one sentence so the roll can
 * lay them out as a list; the em-dash that joins them in the issue text is
 * presentation and lives in the stylesheet's business, not here.
 */
export const CREDITS_SPECIAL_THANKS: readonly SpecialThanks[] = [
  { who: "Hypnotize, Mezmerize, Sonic, scorpion, joep", why: "for keeping Azzurra standing" },
  {
    who: "DeepSET / Johnny^Lizard",
    why: "for embracing grappa and spreading it far and wide",
  },
  { who: "tsk", why: "for suggesting Erlang" },
  { who: "peluche", why: "most assiduous betatester" },
  { who: "nextime", why: "for shottino" },
  { who: "Lucy", why: "for resentin" },
  { who: "Sonic", why: "for bicchierino" },
  {
    who: "morph",
    why: "for spreading grappa, bringing people back, and throwing himself at the ircd and the services again",
  },
  { who: "the whole #sniffo crew", why: "for still being here" },
];
