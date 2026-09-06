// #1931 — the credits' ENDING: what is shown once the prose deck has dealt
// every set it has.
//
// Sibling of `creditsBlock.ts`, and split from it along the same line that
// file draws: `creditsBlock` owns the content of the FIRST block (the cow, the
// special thanks), this one owns the content of the LAST. Between them run the
// `creditsProse` sets, which are the only part of the sequence that repeats.
//
// Both texts here were placeholders while this branch waited on vjt. Both are
// now his: the closing line is his wording, and the manifesto is in on his
// written say-so (2026-09-06). See `CREDITS_MANIFESTO` for what that decision
// was and who made it.

/** The heart, in ASCII. */
export const CREDITS_HEART = "<3";

/**
 * ✅ APPROVED BY vjt, 2026-09-06 — no longer a placeholder.
 *
 * It stood behind a named constant because the issue said the exact words
 * were vjt's call. They ended up being the implementer's, approved with one
 * word of his own: `folks` for `friends`, which is the Looney Tunes cadence
 * the issue asked for arriving in the one place it can arrive without
 * quoting the mark. The constant stays the single edit point.
 *
 * The cadence is Looney Tunes, the words are not — "That's all Folks!" is a
 * Warner Bros. trademark and a trademark does not expire with the copyright
 * on the tune. `creditsFinale.test.ts` forbids the quotation by name, and
 * this line clears it: the recognisable SHAPE without the mark.
 *
 * One line, no newline: the finale lays it out between the heart and the
 * close button, and a paragraph there pushes the button off a phone.
 */
export const CREDITS_FINALE_LINE = "and that's the whole of the wire, folks.";

/** What the finale's own close control says. */
export const CREDITS_CLOSE_LABEL = "click here to close";

/**
 * "The Conscience of a Hacker" — The Mentor (Loyd Blankenship), *Phrack*
 * Vol. 1 Issue 7 Phile 3, 8 January 1986. Shown immediately before the heart.
 *
 * 🟢 SHIPPED ON vjt'S EXPLICIT DECISION, 2026-09-06, and recorded here because
 * it reverses an instruction that is still in this repository's history. The
 * standing order had been *"do not include it until vjt confirms in writing on
 * #grappa"*, the reason being that the text is from 1986, was never dedicated
 * to the public domain and was never put under a free licence — forty years of
 * universal reproduction is CUSTOM, not PERMISSION. vjt cleared it as the
 * repository's owner, stating that the project is open source and that he will
 * comply with a takedown if one is ever asked for. That is his call to make
 * and it is his name on it; this comment exists so the next reader finds the
 * decision rather than re-deriving the block.
 *
 * `CREDITS_MANIFESTO_ATTRIBUTION` renders beside this text and is not optional
 * — it was written before the words arrived precisely so the credit could not
 * become a follow-up nobody files.
 *
 * `String.raw`, not a plain template literal: the Phrack header art is
 * `\/\The Conscience of a Hacker/\/` and a plain literal reads `\/` as an
 * escape for `/`, silently eating the backslashes.
 *
 * The leading whitespace of the original is NOT reproduced. What was pasted in
 * carried a monotonically growing indent (0, 8, 16, ... past 100 columns) that
 * is an editor auto-indent artifact rather than Phrack's layout, and the slot
 * renders `white-space: pre-wrap` inside a 64ch column, where those columns
 * wrap into noise on a phone. Every line is therefore flush left — one rule,
 * applied uniformly, with the paragraph breaks doing the structuring. The
 * words are untouched.
 */
export const CREDITS_MANIFESTO = String.raw`\/\The Conscience of a Hacker/\/

by

+++The Mentor+++

Written on January 8, 1986
=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

Another one got caught today, it's all over the papers.  "Teenager
Arrested in Computer Crime Scandal", "Hacker Arrested after Bank Tampering"...
Damn kids.  They're all alike.

But did you, in your three-piece psychology and 1950's technobrain,
ever take a look behind the eyes of the hacker?  Did you ever wonder what
made him tick, what forces shaped him, what may have molded him?
I am a hacker, enter my world...
Mine is a world that begins with school... I'm smarter than most of
the other kids, this crap they teach us bores me...
Damn underachiever.  They're all alike.

I'm in junior high or high school.  I've listened to teachers explain
for the fifteenth time how to reduce a fraction.  I understand it.  "No, Ms.
Smith, I didn't show my work.  I did it in my head..."
Damn kid.  Probably copied it.  They're all alike.

I made a discovery today.  I found a computer.  Wait a second, this is
cool.  It does what I want it to.  If it makes a mistake, it's because I
screwed it up.  Not because it doesn't like me...
Or feels threatened by me...
Or thinks I'm a smart ass...
Or doesn't like teaching and shouldn't be here...
Damn kid.  All he does is play games.  They're all alike.

And then it happened... a door opened to a world... rushing through
the phone line like heroin through an addict's veins, an electronic pulse is
sent out, a refuge from the day-to-day incompetencies is sought... a board is
found.
"This is it... this is where I belong..."
I know everyone here... even if I've never met them, never talked to
them, may never hear from them again... I know you all...
Damn kid.  Tying up the phone line again.  They're all alike...

You bet your ass we're all alike... we've been spoon-fed baby food at
school when we hungered for steak... the bits of meat that you did let slip
through were pre-chewed and tasteless.  We've been dominated by sadists, or
ignored by the apathetic.  The few that had something to teach found us will-
ing pupils, but those few are like drops of water in the desert.

This is our world now... the world of the electron and the switch, the
beauty of the baud.  We make use of a service already existing without paying
for what could be dirt-cheap if it wasn't run by profiteering gluttons, and
you call us criminals.  We explore... and you call us criminals.  We seek
after knowledge... and you call us criminals.  We exist without skin color,
without nationality, without religious bias... and you call us criminals.
You build atomic bombs, you wage wars, you murder, cheat, and lie to us
and try to make us believe it's for our own good, yet we're the criminals.

Yes, I am a criminal.  My crime is that of curiosity.  My crime is
that of judging people by what they say and think, not what they look like.
My crime is that of outsmarting you, something that you will never forgive me
for.

I am a hacker, and this is my manifesto.  You may stop this individual,
but you can't stop us all... after all, we're all alike.

+++The Mentor+++`;

/**
 * The credit the manifesto ships WITH, written now rather than later.
 *
 * A slot that arrives without an attribution is how a text ends up shipping
 * without one: the words are the interesting part to paste in, the credit is
 * the part that gets left for a follow-up nobody files.
 */
export const CREDITS_MANIFESTO_ATTRIBUTION =
  "The Mentor (Loyd Blankenship) — Phrack Vol. 1, Issue 7, Phile 3, 8 January 1986";
