// #1773 — the credit roll's soundtrack: a synthesised chiptune, with ZERO
// audio assets in the tree.
//
// WHY SYNTHESISED, and why this is not a preference. The issue asked for
// "something epic", and the obvious candidates (Star Wars, Super Mario) are
// under copyright. grappa ships a PUBLIC PWA and a `.deb`, so shipping either
// would put a licence violation in a distro package. The alternatives were an
// original chiptune, a CC0 track with its licence recorded in-tree, or this:
// a few seconds of WebAudio with no asset at all. It is also by far the
// smallest payload, and the modal is already a synthetic-graphics affair, so
// nothing about it is out of place.
//
// Autoplay is legal here because the modal opens on a click — the user
// gesture requirement is satisfied by the thing that mounted this. A
// suspended context is still resumed explicitly: Safari hands one back
// suspended more often than Chromium does.
//
// The AudioContext is handed IN rather than constructed here, and `stop()`
// CLOSES it. Two reasons: jsdom has no AudioContext, so the caller has to do
// the feature test anyway and a constructor inside would make this module
// untestable; and an easter egg that leaves a live audio graph behind a
// closed modal is the battery bug this file's sibling rAF loop was careful
// not to be.
//
// #1916 — the arrangement, and why it is DATA. What shipped in #1773 was one
// 1.92 s bar (eight triangle notes over a static A2 sine) re-armed verbatim
// for as long as the modal stayed open, which reads as a ringtone rather than
// a soundtrack. The phrase became a `bars` ARRAY walked in order (Am → F → C →
// G), the lead became a `square` with the triangle demoted to a MOVING bass
// line, one noise channel took the backbeat, and bars went on a LOOKAHEAD
// cursor rather than being re-based on `ctx.currentTime` at every re-arm.
//
// #1920 — the phrase becomes a SUITE, and the roll picks the movement.
//
// #1916's four bars still repeated verbatim for as long as the modal stayed
// open — about four and a half times per 34 s roll cycle, and identically on
// every cycle, so the second pass of the titles sounded exactly like the
// first. vjt asked for the music to TURN OVER when the titles come back round,
// and for more of it: "più variegata più chiptune più voci".
//
// Three changes, all inside the contract above:
//
//  - `MOVEMENTS` replaces `BARS`. Each movement carries its own progression,
//    its own pulse WIDTH, its own drum pattern, and its own second-channel
//    duty (a harmony line, an arpeggio, or nothing). Adding a movement is
//    adding an entry to that array.
//  - The movement is chosen by `movementAt()`, which the modal wires to its
//    count of the roll's `animationiteration` events — the roll's own clock,
//    the same doctrine `creditsRain.rollIsParked` follows. It USED to read
//    `currentIteration` off the animation; that broke once the roll had to be
//    restarted every turn to re-resolve its keyframes, which zeroes the count
//    (see `CreditsModal.rollPass`). The switch lands on a BAR boundary
//    because the pump only ever arms whole bars.
//  - The channel model is now the four an NES actually has: two pulses, one
//    triangle, one noise. That constraint is the reason `harmony` and `arp`
//    are mutually exclusive per movement rather than both playing — they are
//    the SAME channel, and a chip that could sound both would not be a chip.
//    The pulse width is a `PeriodicWave` (25% and 12.5% duties), which is the
//    single change that most makes this sound like hardware rather than like
//    an oscillator; 50% stays the built-in `square`, so movement one is
//    bit-for-bit the timbre #1916 shipped.
//
// The gain budget did NOT move: `PEAK_GAIN` is unchanged and the per-voice
// peaks below were re-cut so that the worst instant of the busiest movement
// still lands under the pre-#1916 ceiling. `creditsAudio.test.ts` measures
// that across every movement rather than trusting this paragraph.
//
// #1922 — the movements get a RHYTHM, because #1920's did not.
//
// vjt, on the deployed #1920: "ok molto meglio ma le musichette so tutte
// uguali". He is right, and the reason is legible in the score #1920 shipped:
// every bar of every movement was eight eighth-notes walking its chord up, back
// down and out on a step, over four quarter-notes of bass, at one fixed tempo.
// What #1920 varied was the HARMONY (the progression), the TIMBRE (the pulse
// width) and the drum pattern — the colour. What it did not vary was the thing
// an ear actually uses to tell two tunes apart: where the notes fall and how
// long they last. Four transpositions of one rhythm are one tune, played four
// times, and no amount of duty cycle fixes that.
//
// So `lead` and `bass` stop being fixed-length rows of notes and become SLOT
// arrays: the array covers exactly one bar, and its length is the subdivision.
// Eight entries are eighth-notes, sixteen are sixteenths, four are quarters —
// a movement changes its felt tempo by changing its resolution, with the bar
// itself left alone because the bar line is where the suite is allowed to turn
// over (and `BAR_S` is what the roll's cycle is measured in). Two slot values
// are not notes: `null` is a REST, and `"-"` HOLDS the previous note through
// this slot. Those two are what buy syncopation and sustain, and neither can
// be spelled in a row of eight notes that all have to sound.
//
// The result, and it is deliberately six different kinds of music:
//
//   opening   eighths, straight, no rests — #1916's phrase, untouched. It is
//             the pass everybody sees, nobody complained about it, and it is
//             now also the RULER the other five are heard against.
//   swing     eighths with ties and rests: the lead breathes, the bass pumps.
//   descent   half-time — quarter-note lead over a bass that holds three
//             beats, with the sixteenth arpeggio doing the moving.
//   finale    sixteenths, an octave-alternating bass on eighths, hats all the
//             way down. The one that is allowed to be busy.
//   vigil     half-notes. Two lead notes a bar over a bass that changes once,
//             the sparsest thing in the suite.
//   pursuit   TWELVE slots — triplets, the one felt tempo none of the others
//             can spell on a grid that divides by two.
//
// The last two, and the second half of every movement, are the answer to vjt's
// "ci siamo persi il cambio di musichette": a phrase that turned over every
// 7.68 s against a 35 s set was heard four and a half times per set, which is
// what makes a suite sound like a loop. Eight bars puts the phrase at 15.36 s
// — twice per set, and six movements mean the SUITE only comes round after
// six sets rather than four.
//
// Bars 1-4 of the four original movements are byte-for-byte what shipped: the
// second half is an ANSWER to the first, same grid and same timbre, which is
// how a phrase gets longer without becoming a different tune.
//
// The gain budget is again unmoved: no movement sounds two leads at once (a
// held note ends where the next begins) and the voice peaks are untouched, so
// the worst instant is the same lead + second channel + bass + snare it was.
// The test that measures it walks the score, so it re-measures this by itself.

// #1931 — the soundtrack becomes a SEQUENCE, because the credits now end.
//
// Three pieces, in the order the modal walks them: the `suite` above under the
// roll and the prose, a `manifesto` theme under the block that precedes the
// ending, and a one-shot `cadence` under the pulsing heart. vjt asked for the
// joins to be "musichette crossfade" — dissolved, not cut, which is what the
// old teardown-and-restart did.
//
// That is why there are now THREE gain buses under the master rather than one.
// A crossfade needs both pieces audible at the same instant, and one bus
// retargeted cannot express that: it can only dip to silence and come back,
// which is the cut with extra steps. The pieces' notes are scheduled onto
// their own bus at arm time, so the outgoing piece's already-armed bar keeps
// ringing while its bus ramps down and the incoming enters AT ONCE — not at
// the next bar line, which would run the fade out over silence.
//
// The MASTER is untouched by all of this, and that is the load-bearing part of
// the design rather than an accident of layering: `setMuted` and `stop` have
// to work mid-dissolve, when two buses are sounding and three carry ramps
// scheduled into the future. Mute acts on the master, so it silences whatever
// the crossfade happens to be doing without having to fight it on the same
// params; the teardown cancels the pending ramps on every bus before it drops
// the graph, so nothing is being told to come back up while it is dismantled.
// Both cases are pinned by tests, at the exact moment of the fade.
//
// The cadence is ONE-SHOT. The suite loops for as long as the modal is open;
// an ending on a loop is a ringtone, which is the defect #1916 was filed for.

/** Which piece of the sequence is playing. */
export type CreditsPiece = "suite" | "manifesto" | "cadence";

/** A running soundtrack. Every verb is idempotent. */
export type CreditsArpeggio = {
  /** Fade to silence (or back), without tearing down the graph. */
  readonly setMuted: (muted: boolean) => void;
  /**
   * Dissolve to another piece. Asking for the piece already playing does
   * nothing — the modal drives this from a signal that re-fires for reasons of
   * its own, and a re-fire must not restart the music.
   */
  readonly setPiece: (piece: CreditsPiece) => void;
  /** Silence it, drop every node, and CLOSE the context handed to `start`. */
  readonly stop: () => void;
};

// ---------------------------------------------------------------------------
// Pitch — note names rather than a wall of Hz, so the score below reads as a
// score. `Note` is a template-literal type, so a typo is a compile error and
// not a semitone nobody notices.
// ---------------------------------------------------------------------------

const SEMITONE = {
  C: 0,
  "C#": 1,
  D: 2,
  "D#": 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  "G#": 8,
  A: 9,
  "A#": 10,
  B: 11,
} as const;

type PitchClass = keyof typeof SEMITONE;
type Octave = "1" | "2" | "3" | "4" | "5" | "6";
/** Scientific pitch notation — `A2`, `C#5`. */
type Note = `${PitchClass}${Octave}`;

/** MIDI note number. `A4` → 69, `C4` → 60. */
function midiOf(note: Note): number {
  const octave = Number(note.slice(-1));
  const pitchClass = note.slice(0, -1) as PitchClass;
  return (octave + 1) * 12 + SEMITONE[pitchClass];
}

/** Equal temperament off A4 = 440 Hz (MIDI 69). */
function hzOfMidi(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

const PITCH_CLASS_COUNT = 12;

function pitchClassOf(midi: number): number {
  return ((midi % PITCH_CLASS_COUNT) + PITCH_CLASS_COUNT) % PITCH_CLASS_COUNT;
}

/**
 * The nearest note BELOW `midi` that belongs to `chord`, or `null` if the
 * chord has no member in the octave underneath.
 *
 * This is how the harmony line is derived rather than written out: the lead
 * already walks chord tones, so "the chord tone below" tracks it in thirds and
 * fourths that are in key by construction. Writing a second `Eight<Note>` per
 * bar would be the same information typed twice, and the copy that drifts is
 * always the one nobody hums.
 */
function chordToneBelow(midi: number, chord: Chord): number | null {
  // Widened to `number[]` on purpose: `SEMITONE`'s values are a literal union,
  // and an array of it would make `includes` reject the computed pitch class
  // this asks about.
  const classes: number[] = chord.map((name) => SEMITONE[name]);
  for (let candidate = midi - 1; candidate >= midi - PITCH_CLASS_COUNT; candidate -= 1) {
    if (classes.includes(pitchClassOf(candidate))) return candidate;
  }
  return null;
}

/**
 * The chord spelled upward from `root` in `octave`: root, third, fifth, root
 * again an octave up. Each tone is the next occurrence ABOVE the previous one,
 * so a chord whose third is a lower pitch class than its root (A minor: A, C,
 * E) still comes out ascending.
 */
function arpeggioFrom(chord: Chord, octave: number): number[] {
  const notes: number[] = [midiOf(`${chord[0]}${octave}` as Note)];
  for (let i = 1; i <= chord.length; i += 1) {
    const wanted = SEMITONE[chord[i % chord.length] as PitchClass];
    let next = (notes[notes.length - 1] ?? 0) + 1;
    while (pitchClassOf(next) !== wanted) next += 1;
    notes.push(next);
  }
  return notes;
}

// ---------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------

/** Root, third, fifth. The second channel is derived from this, not written. */
type Chord = readonly [PitchClass, PitchClass, PitchClass];

/**
 * One slot of a line. A `Note` sounds; `null` RESTS; `"-"` HOLDS the note in
 * the previous slot through this one.
 *
 * The hold is a slot rather than a duration on the note because the array's
 * length is what says how the bar is divided (see `Line`), and a note carrying
 * its own length would let those two disagree — a bar that adds up to more than
 * a bar, which the scheduler would happily arm straight over the next one.
 */
type Step = Note | null | "-";

/**
 * One bar of one voice. The array covers EXACTLY one bar, so its length is the
 * subdivision: 4 is quarter-notes, 8 eighths, 16 sixteenths. This is how a
 * movement changes its felt tempo without changing `BAR_S`, which has to stay
 * put — it is the grid the suite turns over on and the unit the roll's cycle is
 * counted in.
 */
type Line = readonly [Step, ...Step[]];

/** One bar: a lead line and a bass line over a chord, each on its own grid. */
type Bar = {
  readonly lead: Line;
  readonly bass: Line;
  readonly chord: Chord;
};

type Drum = "hat" | "snare";

/**
 * What the second pulse channel does in a movement. `"harmony"` shadows the
 * lead a chord tone below; `"arp"` runs sixteenths up the chord; `"none"`
 * leaves the channel silent, which is what movement one shipped with.
 *
 * The three are mutually exclusive because they are ONE channel — see the
 * header. This is the type that says so.
 */
type SecondChannel = "none" | "harmony" | "arp";

type Movement = {
  /** Names the movement in the score; not user-visible. */
  readonly name: string;
  readonly bars: readonly [Bar, ...Bar[]];
  /**
   * Pulse width of the LEAD channel. `0.5` is a plain square (the built-in
   * type); anything else is rendered with a `PeriodicWave`.
   */
  readonly duty: number;
  readonly second: SecondChannel;
  /** Pulse width of the second channel, when it plays. */
  readonly secondDuty: number;
  /** One bar of percussion, on its own grid — same rule as `Line`. */
  readonly drums: readonly [Drum | null, ...(Drum | null)[]];
};

// The suite. Six movements of eight bars, all in A minor's orbit so the seams
// are steps rather than key changes: the roll is a joke and the tune should
// land as one, six times over.
//
// Every movement is two half-phrases: bars 1-4 state, bars 5-8 answer. The
// answer keeps the movement's grid, duty and drum pattern — those are its
// identity — and moves the HARMONY somewhere the first half did not go, which
// is why bar 8 wants bar 1 back instead of merely stopping next to it.
//
// Movement one is #1916's phrase, note for note and timbre for timbre, and
// that is deliberate — the first pass of the titles is the one everybody sees,
// and #1920 is not a reason to relitigate a tune nobody complained about.
// The variation is what happens on passes two, three and four.
//
// Every bass line stays inside 87–165 Hz so it sits under the lead instead of
// fighting it, and no lead note goes above B5: `PULSE_HARMONICS` × that is
// still under the Nyquist frequency of a 48 kHz context, and a pulse whose top
// harmonic folds back is an out-of-tune whistle rather than a bright note.
//
// #1922: each movement now owns its RHYTHM as well as its chords — read the
// slot arrays, not just the note names. The six grids are 8 / 8-with-holes /
// 4 / 16 / 2 / 12.
const MOVEMENTS: readonly [Movement, ...Movement[]] = [
  {
    // Pass one: Am → F → C → G, the i–VI–III–VII everyone already knows.
    name: "opening",
    duty: 0.5,
    second: "none",
    secondDuty: 0.25,
    drums: ["hat", "hat", "snare", "hat", "hat", "hat", "snare", "hat"],
    bars: [
      {
        lead: ["A4", "C5", "E5", "A5", "E5", "C5", "A4", "B4"],
        bass: ["A2", "A2", "E3", "A2"],
        chord: ["A", "C", "E"],
      },
      {
        lead: ["F4", "A4", "C5", "F5", "C5", "A4", "F4", "G4"],
        bass: ["F2", "F2", "C3", "F2"],
        chord: ["F", "A", "C"],
      },
      {
        lead: ["E4", "G4", "C5", "E5", "C5", "G4", "E4", "F4"],
        bass: ["C3", "C3", "G2", "C3"],
        chord: ["C", "E", "G"],
      },
      {
        lead: ["D4", "G4", "B4", "D5", "B4", "G4", "D4", "E4"],
        bass: ["G2", "G2", "D3", "G2"],
        chord: ["G", "B", "D"],
      },
      // The answer: the same straight eighths, walked DOWNWARD from the top of
      // the chord instead of up from the root, and turning through Dm to the
      // major V — which is what makes bar 8 lean back into bar 1 rather than
      // sit next to it.
      {
        lead: ["A5", "E5", "C5", "A4", "C5", "E5", "A5", "G5"],
        bass: ["A2", "E3", "A2", "A2"],
        chord: ["A", "C", "E"],
      },
      {
        lead: ["A5", "F5", "C5", "A4", "C5", "F5", "A5", "G5"],
        bass: ["F2", "C3", "F2", "F2"],
        chord: ["F", "A", "C"],
      },
      {
        lead: ["D5", "A4", "F4", "D4", "F4", "A4", "D5", "C5"],
        bass: ["D3", "A2", "D3", "D3"],
        chord: ["D", "F", "A"],
      },
      {
        // G# again: the V of a minor key wants its major third, and this is
        // the bar that hands the phrase back to the Am it started on.
        lead: ["E5", "B4", "G#4", "E4", "G#4", "B4", "E5", "D5"],
        bass: ["E3", "B2", "E3", "E3"],
        chord: ["E", "G#", "B"],
      },
    ],
  },
  {
    // Pass two: down a fourth into Dm → B♭ → F → C, the second pulse comes in
    // underneath the lead, and the width narrows to 25% — the nasal one.
    //
    // #1922 — and the rhythm SWINGS. Still an eighth-note grid, but the lead
    // holds its downbeat through beat two, rests where the opening movement
    // had a note, and comes back in off the beat; the bass answers in the
    // holes rather than marking every beat. Same tempo as the opening, half
    // the note count, and it is unmistakably not the same tune.
    name: "swing",
    duty: 0.25,
    second: "harmony",
    secondDuty: 0.25,
    drums: ["hat", null, "snare", "hat", "hat", null, "snare", "hat"],
    bars: [
      {
        lead: ["D5", "-", "F5", null, "E5", "D5", "-", "A4"],
        bass: ["D3", null, null, "D3", "A2", null, "D3", null],
        chord: ["D", "F", "A"],
      },
      {
        lead: ["A#4", "-", "D5", null, "F5", "D5", "-", "C5"],
        bass: ["A#2", null, null, "A#2", "F2", null, "A#2", null],
        chord: ["A#", "D", "F"],
      },
      {
        lead: ["C5", "-", "A4", null, "F4", "A4", "-", "C5"],
        bass: ["F2", null, null, "F2", "C3", null, "F2", null],
        chord: ["F", "A", "C"],
      },
      {
        lead: ["E5", "-", "G4", null, "C5", "E5", "-", "D5"],
        bass: ["C3", null, null, "C3", "G2", null, "C3", null],
        chord: ["C", "E", "G"],
      },
      // The answer: Gm → C → F → Dm, a ii–V–I that overshoots home and drops
      // back onto the Dm bar 1 opens on. Same tie-and-rest figure throughout —
      // the swing is the movement's signature and does not get to change.
      {
        lead: ["G4", "-", "A#4", null, "D5", "G4", "-", "F4"],
        bass: ["G2", null, null, "G2", "D3", null, "G2", null],
        chord: ["G", "A#", "D"],
      },
      {
        lead: ["C5", "-", "E5", null, "G4", "C5", "-", "B4"],
        bass: ["C3", null, null, "C3", "G2", null, "C3", null],
        chord: ["C", "E", "G"],
      },
      {
        lead: ["F5", "-", "C5", null, "A4", "F4", "-", "G4"],
        bass: ["F2", null, null, "F2", "C3", null, "F2", null],
        chord: ["F", "A", "C"],
      },
      {
        lead: ["D5", "-", "A4", null, "F4", "D5", "-", "E5"],
        bass: ["D3", null, null, "D3", "A2", null, "D3", null],
        chord: ["D", "F", "A"],
      },
    ],
  },
  {
    // Pass three: the Andalusian descent Am → G → F → E, half-time drums, and
    // the second channel switches from a harmony to sixteenths at 12.5% —
    // the thinnest width, which is what makes a chip arpeggio glitter rather
    // than thicken.
    //
    // #1922 — HALF-TIME for real, not just in the drums. The lead is on a
    // four-slot grid (quarter-notes) and opens each bar on a note held through
    // two beats; the bass holds three and steps on the fourth. Four lead notes
    // a bar against the finale's sixteen is the widest contrast the suite has,
    // and the arpeggio is what keeps it from sounding empty.
    name: "descent",
    duty: 0.125,
    second: "arp",
    secondDuty: 0.125,
    drums: ["hat", null, null, null, "snare", null, null, "hat"],
    bars: [
      {
        lead: ["A4", "-", "C5", "E5"],
        bass: ["A2", "-", "-", "E3"],
        chord: ["A", "C", "E"],
      },
      {
        lead: ["G4", "-", "B4", "D5"],
        bass: ["G2", "-", "-", "D3"],
        chord: ["G", "B", "D"],
      },
      {
        lead: ["F4", "-", "A4", "C5"],
        bass: ["F2", "-", "-", "C3"],
        chord: ["F", "A", "C"],
      },
      {
        // The V of a minor key wants its major third: G#, not G. That one
        // accidental is the whole reason this progression sounds like an
        // ending rather than like a loop.
        lead: ["E4", "-", "G#4", "B4"],
        bass: ["E3", "-", "-", "B2"],
        chord: ["E", "G#", "B"],
      },
      // The answer LIFTS where the first half fell: C → B♭ → Dm and back onto
      // the same E. The B♭ is the Phrygian ♭II the Andalusian descent implies
      // and never states, which is why the second half sounds like the same
      // piece arguing with itself rather than like a different one.
      {
        lead: ["C5", "-", "E5", "G5"],
        bass: ["C3", "-", "-", "G2"],
        chord: ["C", "E", "G"],
      },
      {
        lead: ["A#4", "-", "D5", "F5"],
        bass: ["A#2", "-", "-", "F2"],
        chord: ["A#", "D", "F"],
      },
      {
        lead: ["D5", "-", "F5", "A5"],
        bass: ["D3", "-", "-", "A2"],
        chord: ["D", "F", "A"],
      },
      {
        // Falling, where bar 4 rose: the two E bars are the same chord and
        // opposite gestures, and that is the whole join.
        lead: ["B4", "-", "G#4", "E4"],
        bass: ["E3", "-", "-", "B2"],
        chord: ["E", "G#", "B"],
      },
    ],
  },
  {
    // Pass four: C → G → Am → F, the major-key turn, harmony back on, hats on
    // every eighth and a snare on three as well as on two and four. This is
    // the one that is allowed to be loud, and then it wraps back to "opening".
    //
    // #1922 — SIXTEENTHS. The lead runs on a sixteen-slot grid, the bass
    // alternates root and fifth on every eighth, and the drums move onto the
    // lead's grid too. Nothing here is faster in tempo than the opening: it is
    // the same 125 BPM at twice the resolution, which is exactly the trick
    // chip music uses to end on a lap of honour.
    name: "finale",
    duty: 0.25,
    second: "harmony",
    secondDuty: 0.5,
    drums: [
      "hat",
      "hat",
      "hat",
      "hat",
      "snare",
      "hat",
      "hat",
      "hat",
      "hat",
      "hat",
      "hat",
      "hat",
      "snare",
      "hat",
      "snare",
      "hat",
    ],
    bars: [
      {
        lead: [
          "C5",
          "E5",
          "G5",
          "E5",
          "C5",
          "G4",
          "C5",
          "E5",
          "G5",
          "A5",
          "G5",
          "E5",
          "C5",
          "E5",
          "D5",
          "E5",
        ],
        bass: ["C3", "G2", "C3", "G2", "C3", "G2", "C3", "G2"],
        chord: ["C", "E", "G"],
      },
      {
        lead: [
          "B4",
          "D5",
          "G5",
          "D5",
          "B4",
          "G4",
          "B4",
          "D5",
          "G5",
          "A5",
          "G5",
          "D5",
          "B4",
          "D5",
          "A4",
          "B4",
        ],
        bass: ["G2", "D3", "G2", "D3", "G2", "D3", "G2", "D3"],
        chord: ["G", "B", "D"],
      },
      {
        lead: [
          "A4",
          "C5",
          "E5",
          "C5",
          "A4",
          "E4",
          "A4",
          "C5",
          "E5",
          "A5",
          "E5",
          "C5",
          "A4",
          "C5",
          "B4",
          "C5",
        ],
        bass: ["A2", "E3", "A2", "E3", "A2", "E3", "A2", "E3"],
        chord: ["A", "C", "E"],
      },
      {
        lead: [
          "F4",
          "A4",
          "C5",
          "A4",
          "F4",
          "C4",
          "F4",
          "A4",
          "C5",
          "F5",
          "C5",
          "A4",
          "F4",
          "A4",
          "G4",
          "A4",
        ],
        bass: ["F2", "C3", "F2", "C3", "F2", "C3", "F2", "C3"],
        chord: ["F", "A", "C"],
      },
      // The answer: Dm → G → C → E. Same sixteenths, same alternating bass,
      // but the runs sit a register lower than bars 1-4 so the second half is
      // audibly the reply and not a repeat, and it ends on the dominant E
      // rather than on the F it would otherwise circle from.
      {
        lead: [
          "D5",
          "F5",
          "A5",
          "F5",
          "D5",
          "A4",
          "D5",
          "F5",
          "A5",
          "G5",
          "A5",
          "F5",
          "D5",
          "F5",
          "E5",
          "F5",
        ],
        bass: ["D3", "A2", "D3", "A2", "D3", "A2", "D3", "A2"],
        chord: ["D", "F", "A"],
      },
      {
        lead: [
          "G4",
          "B4",
          "D5",
          "B4",
          "G4",
          "D4",
          "G4",
          "B4",
          "D5",
          "E5",
          "D5",
          "B4",
          "G4",
          "B4",
          "A4",
          "B4",
        ],
        bass: ["G2", "D3", "G2", "D3", "G2", "D3", "G2", "D3"],
        chord: ["G", "B", "D"],
      },
      {
        lead: [
          "C5",
          "G4",
          "E5",
          "G4",
          "C5",
          "E4",
          "G4",
          "C5",
          "E5",
          "G5",
          "E5",
          "C5",
          "G4",
          "C5",
          "B4",
          "C5",
        ],
        bass: ["C3", "G2", "C3", "G2", "C3", "G2", "C3", "G2"],
        chord: ["C", "E", "G"],
      },
      {
        // The D5 in the second half is the ♭7 an E7 wants: it is what turns
        // "loud bar on the V" into "the suite is about to start again".
        lead: [
          "E4",
          "G#4",
          "B4",
          "E5",
          "G#5",
          "E5",
          "B4",
          "G#4",
          "E4",
          "B4",
          "E5",
          "G#5",
          "E5",
          "B4",
          "D5",
          "B4",
        ],
        bass: ["E3", "B2", "E3", "B2", "E3", "B2", "E3", "B2"],
        chord: ["E", "G#", "B"],
      },
    ],
  },
  {
    // Pass five: the room the finale does not leave. Two lead notes a bar on a
    // TWO-slot grid — half-notes, the slowest thing in the suite against the
    // finale's sixteenths — a bass that changes once a bar and never restrikes
    // under itself, and a drum line down to a hat and one snare.
    //
    // The width is 50%, the same plain square the opening uses, and that is
    // deliberate: with the harmony channel underneath it and nothing else
    // moving, the pair reads as an organ rather than as movement one slowed
    // down. Am → C → F → G, then Am → Dm → E → Am, which is the only movement
    // that lands on its own tonic instead of handing off on the dominant.
    name: "vigil",
    duty: 0.5,
    second: "harmony",
    secondDuty: 0.125,
    drums: ["hat", null, "snare", null],
    bars: [
      { lead: ["A4", "E5"], bass: ["A2", "E3"], chord: ["A", "C", "E"] },
      { lead: ["C5", "G4"], bass: ["C3", "G2"], chord: ["C", "E", "G"] },
      { lead: ["F4", "C5"], bass: ["F2", "C3"], chord: ["F", "A", "C"] },
      { lead: ["D5", "B4"], bass: ["G2", "D3"], chord: ["G", "B", "D"] },
      { lead: ["C5", "A4"], bass: ["A2", "E3"], chord: ["A", "C", "E"] },
      { lead: ["D5", "F5"], bass: ["D3", "A2"], chord: ["D", "F", "A"] },
      { lead: ["B4", "G#4"], bass: ["E3", "B2"], chord: ["E", "G#", "B"] },
      // One note, one bar. The hold is the point: everything else in the suite
      // articulates, and this is the one place that simply rings out.
      { lead: ["A4", "-"], bass: ["A2", "-"], chord: ["A", "C", "E"] },
    ],
  },
  {
    // Pass six: TRIPLETS. Twelve slots to the bar, which is the one thing none
    // of the other five can spell — every grid in the file so far divides the
    // bar by two, so "the same tempo in three" is a felt tempo the suite did
    // not have. The bass runs six slots (triplet quarters) under it and the
    // hats mark the two groups of three that make the swing legible.
    //
    // 37.5% duty: a width nothing else uses, between the opening's square and
    // the swing's nasal 25%. The second channel is the arpeggio rather than a
    // harmony — sixteenths against triplets is a deliberate cross-rhythm, and
    // it is the reason this one sounds hurried where "vigil" sounds still.
    name: "pursuit",
    duty: 0.375,
    second: "arp",
    secondDuty: 0.125,
    drums: ["hat", null, "hat", "snare", null, "hat", "hat", null, "hat", "snare", null, "hat"],
    bars: [
      {
        lead: ["A4", "C5", "E5", "A5", "-", null, "E5", "C5", "A4", "-", "B4", null],
        bass: ["A2", null, "E3", null, "A2", null],
        chord: ["A", "C", "E"],
      },
      {
        lead: ["E5", "A5", "E5", "C5", "-", null, "A4", "B4", "C5", "-", "E5", null],
        bass: ["A2", null, "E3", null, "A2", null],
        chord: ["A", "C", "E"],
      },
      {
        lead: ["D5", "F5", "A5", "D5", "-", null, "A4", "F4", "D4", "-", "E4", null],
        bass: ["D3", null, "A2", null, "D3", null],
        chord: ["D", "F", "A"],
      },
      {
        lead: ["E5", "B4", "G#4", "E4", "-", null, "G#4", "B4", "E5", "-", "D5", null],
        bass: ["E3", null, "B2", null, "E3", null],
        chord: ["E", "G#", "B"],
      },
      {
        lead: ["A4", "B4", "C5", "E5", "-", null, "C5", "B4", "A4", "-", "G4", null],
        bass: ["A2", null, "E3", null, "A2", null],
        chord: ["A", "C", "E"],
      },
      {
        lead: ["F4", "A4", "C5", "F5", "-", null, "C5", "A4", "F4", "-", "G4", null],
        bass: ["F2", null, "C3", null, "F2", null],
        chord: ["F", "A", "C"],
      },
      {
        lead: ["A4", "D5", "F5", "A5", "-", null, "F5", "D5", "A4", "-", "G4", null],
        bass: ["D3", null, "A2", null, "D3", null],
        chord: ["D", "F", "A"],
      },
      {
        // Ends on the V, and the V hands over to the opening's Am — which is
        // where the suite wraps.
        lead: ["G#4", "B4", "E5", "G#5", "-", null, "E5", "B4", "G#4", "-", "D5", null],
        bass: ["E3", null, "B2", null, "E3", null],
        chord: ["E", "G#", "B"],
      },
    ],
  },
];

/**
 * The manifesto's own theme (#1931).
 *
 * Deliberately not a fifth movement of the suite: it plays under ~570 words
 * somebody is READING, so it has to stay out of the way in a manner none of
 * the four does. Quarter-note grid with every note held through three of the
 * four slots, the thinnest pulse in the file, and — the thing that separates
 * it at a glance — NO PERCUSSION AT ALL. Nothing marching under the text.
 *
 * The progression is the Andalusian descent the "descent" movement also walks,
 * because it is the one shape in A minor that reads as gravity rather than as
 * a loop; what makes this a different piece is everything else — no drums, no
 * second channel, one note a bar in the lead and a bass that never restrikes.
 */
const MANIFESTO_MOVEMENT: Movement = {
  name: "manifesto",
  duty: 0.125,
  second: "none",
  secondDuty: 0.125,
  // One slot, empty: the type wants a non-empty tuple, and this is how "no
  // percussion" is spelled in it rather than by making the field optional.
  drums: [null],
  bars: [
    { lead: ["A4", "-", "-", "E4"], bass: ["A2", "-", "-", "-"], chord: ["A", "C", "E"] },
    { lead: ["G4", "-", "-", "D4"], bass: ["G2", "-", "-", "-"], chord: ["G", "B", "D"] },
    { lead: ["F4", "-", "-", "C4"], bass: ["F2", "-", "-", "-"], chord: ["F", "A", "C"] },
    // The V wants its major third in a minor key — the same G# the suite's
    // "descent" leans on, and the reason this stops rather than circles.
    { lead: ["E4", "-", "-", "B3"], bass: ["E3", "-", "-", "-"], chord: ["E", "G#", "B"] },
  ],
};

/**
 * The closing cadence (#1931) — ONE bar, five notes, played once.
 *
 * 🔴 ORIGINAL, and that is a licence constraint rather than a stylistic one.
 * The Looney Tunes outro is "The Merry-Go-Round Broke Down" (1937), whose US
 * copyright runs to 2033, and "That's all Folks!" is a Warner Bros. TRADEMARK,
 * which does not expire at all. So this quotes nothing: what it borrows is the
 * SHAPE an ending has — rise, turn, land — which is not anybody's property.
 *
 * A4 → C5 → E5 up, D5 → A4 back down, the last note held through two slots so
 * it settles instead of stopping. The bass walks the plagal iv–i underneath
 * (F2 under the turn, A2 under the landing), which is the "amen" motion and is
 * why four rising notes read as finished rather than as interrupted.
 *
 * No drums, for the reason the manifesto has none: a backbeat here would make
 * it bar five of the suite.
 */
const CADENCE_BAR: Movement = {
  name: "cadence",
  duty: 0.5,
  second: "none",
  secondDuty: 0.25,
  drums: [null],
  bars: [
    {
      lead: ["A4", "C5", "E5", "-", "D5", "-", "A4", "-"],
      bass: ["A2", null, "E3", null, "F2", null, "A2", "-"],
      chord: ["A", "C", "E"],
    },
  ],
};

/**
 * One eighth note. 0.24 s ⇒ 125 BPM, unchanged from #1773.
 *
 * Since #1922 this is no longer the note length — each line divides `BAR_S` by
 * its own slot count — but it is still what a bar is eight of, i.e. the tempo.
 */
const STEP_S = 0.24;
/** Bar length, in seconds. The one grid every movement shares. */
export const BAR_S = 8 * STEP_S;
/** How many movements the suite walks before it wraps back to the first. */
export const MOVEMENT_COUNT = MOVEMENTS.length;
/**
 * How many bars a movement runs. Every movement is the same length on
 * purpose — the roll's cycle is the loop point, not the phrase's, so a
 * movement that ran long would only ever be heard truncated. Pinned by a test
 * rather than by this comment.
 */
export const BAR_COUNT = MOVEMENTS[0].bars.length;
/** How long ONE movement runs before it repeats. */
export const PHRASE_S = BAR_COUNT * BAR_S;

/** The second channel's sixteenths, when it is running an arpeggio. */
const ARP_S = STEP_S / 2;
const HAT_S = 0.03;
const SNARE_S = 0.12;

// ---------------------------------------------------------------------------
// Gain budget
//
// Quiet on purpose: this opens without being asked for, on a surface someone
// may be showing a colleague. Loud enough to be a joke, not loud enough to be
// an incident.
//
// `PEAK_GAIN` is the master and is UNCHANGED from #1773. Every voice below
// declares its envelope peak RELATIVE to it, so the worst instant this mix can
// produce is `PEAK_GAIN × (sum of the peaks of whatever overlaps)`. #1773's
// worst instant was a lead note (1) over the drone (0.025 / 0.06 = 0.4167) —
// 1.4167, i.e. 0.085 absolute, and that is still the ceiling.
//
// #1920 spends the headroom differently rather than asking for more of it: a
// lead that has a second pulse channel under it comes DOWN from 1 by exactly
// what that channel takes, and a lead that does not keeps its old level. So
// the busiest instant is the same either way — lead + harmony + bass + snare
// (0.74 + 0.26 + 0.24 + 0.12) and lead + bass + snare (1 + 0.24 + 0.12) both
// land on 1.36, under the 1.4167 that #1916 sat at 1.41 against.
// `creditsAudio.test.ts` measures that off the score, across every movement,
// rather than trusting the arithmetic in this comment.
// ---------------------------------------------------------------------------

/** Master gain. Deliberate, and not to be raised — see above. */
export const PEAK_GAIN = 0.06;
/**
 * The lead's peak when a second pulse channel is sounding under it. The
 * headroom it gives up is exactly what that channel spends.
 */
const LEAD_PEAK = 0.74;
/**
 * ...and its peak when nothing is. A movement with a silent second channel
 * has no one to make room for, so it keeps #1916's level — which matters for
 * the OPENING movement specifically: it is the pass everybody hears, it is
 * unchanged in pitch and in timbre, and there is no reason for #1920 to have
 * made it quieter as a side effect of what happens on pass two.
 */
const LEAD_SOLO_PEAK = 1;
const HARMONY_PEAK = 0.26;
const ARP_PEAK = 0.2;
const BASS_PEAK = 0.24;
const HAT_PEAK = 0.05;
const SNARE_PEAK = 0.12;

/** Ramp constant for the mute toggle. An instant gain jump clicks. */
const MUTE_RAMP_S = 0.02;
/**
 * How long one piece takes to dissolve into the next (#1931).
 *
 * Just under half a bar. Long enough to hear as a dissolve rather than as a
 * cut, short enough that the outgoing bar — already armed, and at most one bar
 * long — is still sounding for the whole of it, which is what makes the
 * overlap real instead of a fade into a gap.
 */
const CROSSFADE_S = 0.9;
/** Exponential ramps cannot reach zero; this is the working silence. */
const GAIN_FLOOR = 0.0001;
/** Fraction of a note spent decaying — the rest is the gap that articulates it. */
const DECAY_FRACTION = 0.9;
const ATTACK_S = 0.006;

// ---------------------------------------------------------------------------
// The score, expanded to events
// ---------------------------------------------------------------------------

export type CreditsVoice = "lead" | "harmony" | "arp" | "bass" | "hat" | "snare";

/** One scheduled sound. Times are relative to the START OF ITS BAR. */
export type CreditsEvent = {
  readonly voice: CreditsVoice;
  /** Oscillator pitch, or `null` for the noise voices. */
  readonly hz: number | null;
  /**
   * Pulse width for the two pulse channels, `null` for everything else. `0.5`
   * is the built-in `square`; the other widths need a `PeriodicWave`, which is
   * why this is data on the event rather than a branch in the renderer.
   */
  readonly duty: number | null;
  readonly at: number;
  /** How long the source runs before it is stopped. */
  readonly durS: number;
  /**
   * How long the envelope takes to reach silence — always shorter than
   * `durS`, and the gap between the two is what articulates one note from the
   * next. It is a FIELD rather than a fraction applied at render time because
   * it is the note's audible span, and that is what a loudness measurement has
   * to sum over: measuring against `durS` instead makes two adjacent notes
   * "overlap" by one float ULP and doubles the answer.
   */
  readonly decayS: number;
  /** Envelope peak RELATIVE to the master gain: 1 means `PEAK_GAIN`. */
  readonly peak: number;
};

/** A sounded note of a line: when it starts, how long it runs, what pitch. */
type Sounded = { readonly midi: number; readonly at: number; durS: number };

/** Floats that came out of two different divisions of `BAR_S`. */
const TIME_EPS = 1e-9;

/**
 * A `Line` laid out in time. The array covers one bar, so the slot length is
 * `BAR_S / line.length`; `null` slots sound nothing and `"-"` slots lengthen
 * whatever is already running.
 *
 * A `"-"` with nothing to hold — first slot of a bar, or straight after a rest
 * — is simply a rest. Making it an error would buy a compile-time check on a
 * score nobody but this file writes, and cost the ability to start a bar on the
 * tail of the one before it.
 */
function soundLine(line: readonly Step[]): Sounded[] {
  const slotS = BAR_S / line.length;
  const out: Sounded[] = [];
  line.forEach((step, i) => {
    const at = i * slotS;
    if (step === null) return;
    if (step === "-") {
      const held = out[out.length - 1];
      // Only extend a note that runs up to THIS slot: a hold after a rest has
      // nothing to attach to, and lengthening the note before the rest would
      // sound through the silence that was written on purpose.
      if (held !== undefined && Math.abs(held.at + held.durS - at) < TIME_EPS) {
        held.durS += slotS;
      }
      return;
    }
    out.push({ midi: midiOf(step), at, durS: slotS });
  });
  return out;
}

/** Wrap an index into `[0, length)`, negatives included. */
function wrap(index: number, length: number): number {
  return ((index % length) + length) % length;
}

/** The movement at suite position `index`, which wraps. */
function movementAtIndex(index: number): Movement {
  // `?? MOVEMENTS[0]` is unreachable after the wrap; it is how a non-empty
  // tuple is spelled under `noUncheckedIndexedAccess` without a throw.
  return MOVEMENTS[wrap(index, MOVEMENT_COUNT)] ?? MOVEMENTS[0];
}

/**
 * The events of bar `index` of movement `movement`. Both indices wrap, so
 * `creditsBar(BAR_COUNT)` is bar 0 again and `creditsBar(0, MOVEMENT_COUNT)`
 * is the opening movement again.
 *
 * Pure: the scheduler renders these, and the test measures them.
 */
export function creditsBar(index: number, movement = 0): readonly CreditsEvent[] {
  return barEvents(movementAtIndex(movement), index);
}

/**
 * The name of the movement at suite position `index`, which wraps like the
 * scheduler's own read does. Shown next to the mute button while the music is
 * on, so a listener can say WHICH movement did the thing they are reporting —
 * the suite turns over on the roll's pass, and by the time a bug is described
 * the music has usually moved on.
 */
export function creditsMovementName(index: number): string {
  return movementAtIndex(index).name;
}

/**
 * Bar `index` of the manifesto's theme (#1931). Wraps, like the suite's: the
 * text takes as long as it takes to read, so the piece under it loops.
 */
export function creditsManifestoBar(index: number): readonly CreditsEvent[] {
  return barEvents(MANIFESTO_MOVEMENT, index);
}

/**
 * The closing cadence (#1931), in full. Takes no index because it does not
 * loop — that is the whole point of it, and a parameter would invite one.
 */
export function creditsCadence(): readonly CreditsEvent[] {
  return barEvents(CADENCE_BAR, 0);
}

/**
 * One bar of any score, expanded to events. Pure: the scheduler renders these
 * and the tests measure them.
 *
 * Split out of `creditsBar` by #1931 so the manifesto theme and the cadence
 * are rendered by the SAME code as the suite rather than by a second copy of
 * it — the copy that drifts is the one nobody listens to.
 */
function barEvents(score: Movement, index: number): readonly CreditsEvent[] {
  const bar = score.bars[wrap(index, score.bars.length)] ?? score.bars[0];
  const events: CreditsEvent[] = [];
  const leadPeak = score.second === "none" ? LEAD_SOLO_PEAK : LEAD_PEAK;
  const lead = soundLine(bar.lead);

  for (const note of lead) {
    events.push({
      voice: "lead",
      hz: hzOfMidi(note.midi),
      duty: score.duty,
      at: note.at,
      durS: note.durS,
      decayS: note.durS * DECAY_FRACTION,
      peak: leadPeak,
    });
  }

  if (score.second === "harmony") {
    for (const note of lead) {
      const below = chordToneBelow(note.midi, bar.chord);
      // A lead note with no chord tone under it inside an octave simply gets
      // no shadow that step. Skipping beats transposing it somewhere in-key
      // but wrong.
      if (below === null) continue;
      events.push({
        voice: "harmony",
        hz: hzOfMidi(below),
        duty: score.secondDuty,
        // The lead's own placement, held note lengths included: a harmony on
        // its own grid would flam against the note it is shadowing.
        at: note.at,
        durS: note.durS,
        decayS: note.durS * DECAY_FRACTION,
        peak: HARMONY_PEAK,
      });
    }
  }

  if (score.second === "arp") {
    const figure = arpeggioFrom(bar.chord, 4);
    const steps = Math.round(BAR_S / ARP_S);
    for (let i = 0; i < steps; i += 1) {
      events.push({
        voice: "arp",
        hz: hzOfMidi(figure[i % figure.length] ?? figure[0] ?? 0),
        duty: score.secondDuty,
        at: i * ARP_S,
        durS: ARP_S,
        decayS: ARP_S * DECAY_FRACTION,
        peak: ARP_PEAK,
      });
    }
  }

  for (const note of soundLine(bar.bass)) {
    events.push({
      voice: "bass",
      hz: hzOfMidi(note.midi),
      duty: null,
      at: note.at,
      durS: note.durS,
      decayS: note.durS * DECAY_FRACTION,
      peak: BASS_PEAK,
    });
  }

  // The drums are hits, not notes: their length is the sound of the hit and
  // does not follow the grid, so only the placement is read off the array.
  const drumSlotS = BAR_S / score.drums.length;
  score.drums.forEach((drum, i) => {
    if (drum === null) return;
    const durS = drum === "hat" ? HAT_S : SNARE_S;
    events.push({
      voice: drum,
      hz: null,
      duty: null,
      at: i * drumSlotS,
      durS,
      decayS: durS * DECAY_FRACTION,
      peak: drum === "hat" ? HAT_PEAK : SNARE_PEAK,
    });
  });

  return events;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/** Seconds of noise held in the shared buffer bursts are cut out of. */
const NOISE_S = 1;
/** How far ahead of the audio clock a bar is armed. */
const LOOKAHEAD_S = 0.35;
/** How often the main thread checks whether the next bar is due. */
const PUMP_MS = 100;
/**
 * Harmonics summed into a pulse `PeriodicWave`. Enough for the width to be
 * audible as a width (a 12.5% pulse needs its eighth harmonic to be a 12.5%
 * pulse at all), few enough that a high lead note does not alias: the top note
 * in the suite is B5 at ~988 Hz, and 24 × 988 is under half of even a 48 kHz
 * rate.
 */
const PULSE_HARMONICS = 24;

/**
 * Ramp one bus to `to`, arriving `CROSSFADE_S` after `now` (#1931).
 *
 * The three lines are the standard "freeze where you are, then ramp" idiom and
 * the order matters: the CURRENT value is read first (the `AudioParam` getter
 * reports the live automated value, not the last one anybody assigned), then
 * the future is cleared, then that value is pinned at `now` so the new ramp
 * has a defined starting point. Skipping the pin makes the ramp start from
 * whatever the last scheduled event left behind, which mid-dissolve is not
 * where the bus actually is — the fade would jump before it slid.
 *
 * `linearRampToValueAtTime`, not the `setTargetAtTime` the mute uses:
 * `setTargetAtTime` approaches its target asymptotically and never arrives, so
 * two of them cannot share the instant that makes a pair of ramps a crossfade.
 */
function fadeBus(bus: GainNode, to: number, now: number): void {
  const from = bus.gain.value;
  bus.gain.cancelScheduledValues(now);
  bus.gain.setValueAtTime(from, now);
  bus.gain.linearRampToValueAtTime(to, now + CROSSFADE_S);
}

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * NOISE_S));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * A pulse wave of the given duty cycle, or `null` if this context cannot make
 * one (jsdom's stub, or an engine that refuses).
 *
 * The Fourier series of a duty-`d` pulse has sine coefficients
 * `(2 / nπ)·sin(nπd)`; at `d = 0.5` every even term vanishes and it is a
 * square, which is why 50% never comes through here. Normalisation is left ON
 * so the rendered peak stays ≤ 1 — the gain budget above is stated in those
 * terms and a de-normalised wave would quietly break it.
 */
function pulseWave(ctx: AudioContext, duty: number): PeriodicWave | null {
  if (typeof ctx.createPeriodicWave !== "function") return null;
  const real = new Float32Array(PULSE_HARMONICS + 1);
  const imag = new Float32Array(PULSE_HARMONICS + 1);
  for (let n = 1; n <= PULSE_HARMONICS; n += 1) {
    imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
  }
  try {
    return ctx.createPeriodicWave(real, imag);
  } catch {
    return null;
  }
}

/**
 * Start the soundtrack on `ctx`, which this function then OWNS — `stop()`
 * closes it. Never throws: a browser that refuses a node leaves the modal
 * silent rather than broken.
 *
 * @param movementAt reads which pass of the credit roll is on screen; the
 *   suite follows it, so the music turns over exactly when the titles do. The
 *   default keeps the opening movement forever, which is what a caller with no
 *   roll to read (and every test that does not care) wants.
 */
export function startCreditsArpeggio(
  ctx: AudioContext,
  muted: boolean,
  movementAt: () => number = () => 0,
): CreditsArpeggio {
  const master = ctx.createGain();
  master.gain.value = muted ? 0 : PEAK_GAIN;
  master.connect(ctx.destination);

  // #1931 — one bus per piece, all under the master. Unit gains: the master
  // owns the volume (and therefore the mute), these own only WHO is heard, so
  // a crossfade never has to know what the level is.
  const buses: Record<CreditsPiece, GainNode> = {
    suite: ctx.createGain(),
    manifesto: ctx.createGain(),
    cadence: ctx.createGain(),
  };
  for (const [name, bus] of Object.entries(buses) as [CreditsPiece, GainNode][]) {
    bus.gain.value = name === "suite" ? 1 : 0;
    bus.connect(master);
  }

  // Every source is kept so `stop()` can silence one scheduled a beat into the
  // future — `onended` cannot be relied on for that, because a note that has
  // not started yet never ends.
  const voices: AudioScheduledSourceNode[] = [];
  const waves = new Map<number, PeriodicWave | null>();
  let noise: AudioBuffer | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let barIndex = 0;
  let movement = 0;
  let nextBarAt = 0;
  let piece: CreditsPiece = "suite";

  // Built once per width and cached: a `PeriodicWave` is immutable and shared
  // by every oscillator that uses it, so making one per note would be a few
  // hundred allocations a minute for an identical object.
  const waveFor = (duty: number): PeriodicWave | null => {
    const cached = waves.get(duty);
    if (cached !== undefined) return cached;
    const built = pulseWave(ctx, duty);
    waves.set(duty, built);
    return built;
  };

  // Called once the source has been STARTED: `stop()` on a source that never
  // started is an InvalidStateError, and the two sources start differently
  // (an oscillator takes a time, a burst takes a time and an offset).
  const keep = (source: AudioScheduledSourceNode, env: GainNode, stopAt: number): void => {
    source.stop(stopAt);
    voices.push(source);
    source.onended = (): void => {
      const i = voices.indexOf(source);
      if (i !== -1) voices.splice(i, 1);
      source.disconnect();
      env.disconnect();
    };
  };

  const scheduleEvent = (event: CreditsEvent, base: number, bus: GainNode): void => {
    const at = base + event.at;
    // A browser that refused the buffer gets no percussion; the tuned voices
    // still play. Checked BEFORE the gain node so the refusal costs no node.
    if (event.hz === null && noise === null) return;

    const env = ctx.createGain();
    // Pluck: near-instant attack, exponential decay over the note. Exponential
    // because a linear fade on a plucked tone reads as a cut.
    env.gain.setValueAtTime(GAIN_FLOOR, at);
    env.gain.exponentialRampToValueAtTime(event.peak, at + Math.min(ATTACK_S, event.durS * 0.2));
    env.gain.exponentialRampToValueAtTime(GAIN_FLOOR, at + event.decayS);
    // The bus of the piece that ARMED this note, captured by the caller — not
    // whichever piece happens to be current when it sounds. That is what lets
    // the outgoing piece ring on through its own fade.
    env.connect(bus);

    if (event.hz === null && noise !== null) {
      const burst = ctx.createBufferSource();
      burst.buffer = noise;
      burst.connect(env);
      // Cut each burst from a different place in the buffer, or every hat is
      // byte-identical and the row reads as a machine gun rather than a hat.
      burst.start(at, Math.random() * Math.max(0, NOISE_S - event.durS));
      keep(burst, env, at + event.durS);
      return;
    }

    const osc = ctx.createOscillator();
    // THE chip channel model (#1916, widened by #1920): pulses on top, one
    // triangle underneath. A width other than 50% needs a `PeriodicWave`, and
    // an engine that will not give us one falls back to the square rather than
    // to silence.
    const wave = event.duty === null || event.duty === 0.5 ? null : waveFor(event.duty);
    if (wave !== null) {
      osc.setPeriodicWave(wave);
    } else {
      osc.type = event.duty === null ? "triangle" : "square";
    }
    osc.frequency.value = event.hz ?? 0;
    osc.connect(env);
    osc.start(at);
    keep(osc, env, at + event.durS);
  };

  // The roll's pass, defended. A caller whose accessor throws or answers with
  // a NaN must not take the modal's audio down with it, nor jump the suite to
  // a movement that does not exist: either way the music simply stays where it
  // was, which is inaudible as a failure.
  const readMovement = (): number => {
    try {
      const next = movementAt();
      return Number.isFinite(next) ? next : movement;
    } catch {
      return movement;
    }
  };

  // Bars are placed against `ctx.currentTime` and never against a timer: a
  // per-note timer would put the rhythm on the main thread's mercy. The timer
  // only asks "is the next bar within the lookahead window yet".
  const pump = (): void => {
    if (stopped) return;
    // A backgrounded tab freezes setTimeout while the audio clock keeps
    // running. Without this resync the catch-up below would arm every missed
    // bar at once with start times in the PAST — which WebAudio renders
    // immediately, i.e. all together. That is the one way this can get loud,
    // and it is exactly the case the gain budget above cannot defend against.
    if (nextBarAt < ctx.currentTime) nextBarAt = ctx.currentTime;
    while (nextBarAt < ctx.currentTime + LOOKAHEAD_S) {
      // #1931 — the cadence is one bar and then silence. `break` rather than
      // `return` so the timer below stays alive: it costs nothing and it keeps
      // the pump answerable if a piece is ever selected after this one.
      if (piece === "cadence" && barIndex > 0) break;

      let events: readonly CreditsEvent[];
      if (piece === "suite") {
        // Read the roll's pass HERE, one bar before it is heard: the movement
        // can therefore only change on a bar line, never mid-phrase.
        // Restarting `barIndex` is what makes the new movement enter at its
        // OWN first bar instead of wherever the outgoing one had got to.
        const wanted = wrap(readMovement(), MOVEMENT_COUNT);
        if (wanted !== movement) {
          movement = wanted;
          barIndex = 0;
        }
        events = creditsBar(barIndex, movement);
      } else if (piece === "manifesto") {
        events = creditsManifestoBar(barIndex);
      } else {
        events = creditsCadence();
      }

      const bus = buses[piece];
      for (const event of events) scheduleEvent(event, nextBarAt, bus);
      barIndex += 1;
      nextBarAt += BAR_S;
    }
    timer = setTimeout(pump, PUMP_MS);
  };

  try {
    if (ctx.state === "suspended") void ctx.resume();
    noise = makeNoiseBuffer(ctx);
    nextBarAt = ctx.currentTime;
    pump();
  } catch {
    // A browser that refuses to start the graph gets a silent modal, not a
    // broken one. Nothing below depends on the loop having armed.
  }

  return {
    setMuted: (next: boolean): void => {
      if (stopped) return;
      // On the MASTER, deliberately: it sits above every bus, so this silences
      // a crossfade in flight without touching — or being fought by — the
      // ramps the crossfade has scheduled on the buses themselves.
      master.gain.setTargetAtTime(next ? 0 : PEAK_GAIN, ctx.currentTime, MUTE_RAMP_S);
    },

    setPiece: (next: CreditsPiece): void => {
      if (stopped || next === piece) return;
      const now = ctx.currentTime;
      // Both ramps land on the SAME instant, which is what makes the pair a
      // dissolve rather than a dip to silence and back.
      fadeBus(buses[piece], 0, now);
      fadeBus(buses[next], 1, now);

      piece = next;
      barIndex = 0;
      // The incoming piece enters AT ONCE rather than at the next bar line,
      // which can be most of a bar away — the fade would otherwise run out
      // over silence. The outgoing bar is already armed on its own bus and
      // keeps ringing, so the two genuinely overlap.
      nextBarAt = now;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pump();
    },

    stop: (): void => {
      if (stopped) return;
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      // Cancel BEFORE dropping the graph. Mid-dissolve there are ramps
      // scheduled into the future on three buses, and leaving them in place
      // tells the graph to come back up while it is being dismantled. Closing
      // the context would mask it in practice — which is exactly why this is
      // explicit and has a test of its own.
      const at = ctx.currentTime;
      master.gain.cancelScheduledValues(at);
      for (const bus of Object.values(buses)) {
        bus.gain.cancelScheduledValues(at);
      }
      for (const voice of voices) {
        try {
          voice.stop();
        } catch {
          // Already stopped, or never started. Either way it is silent.
        }
        voice.disconnect();
      }
      voices.length = 0;
      waves.clear();
      for (const bus of Object.values(buses)) bus.disconnect();
      master.disconnect();
      void ctx.close();
    },
  };
}
