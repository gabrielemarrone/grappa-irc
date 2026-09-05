import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BAR_COUNT,
  BAR_S,
  type CreditsEvent,
  creditsBar,
  MOVEMENT_COUNT,
  PEAK_GAIN,
  PHRASE_S,
  startCreditsArpeggio,
} from "../lib/creditsAudio";

// #1773 — the credit roll's synthesised soundtrack.
//
// Two things are worth proving here and neither is the music. The first is
// that it can be SILENCED, because the modal autoplays: it opens on a click,
// so the browser lets it, which means the mute control is the only thing
// standing between an easter egg and someone's open-plan office. The second
// is that it LEAVES NOTHING BEHIND — a scheduler still arming oscillators
// behind a dismissed dialog is the same battery bug as an orphaned rAF loop,
// and it is completely inaudible, so nothing but a test would ever catch it.
//
// jsdom has no WebAudio at all. The AudioContext is handed in rather than
// constructed by the module precisely so this file can supply one; the
// component does the feature test.
//
// #1916 — a third thing joins them: the arrangement is now several bars long,
// and "several bars" is the kind of claim that rots into "one bar" the moment
// someone tidies the scheduler. So the progression is proven at both ends —
// as data (`creditsBar`) and as what the scheduler actually arms over time.
// The melody itself is still NOT pinned: no test below names a frequency or a
// step length, so the tune can be rewritten without touching this file. What
// is pinned is the shape (bars differ, the phrase is the loop point), the
// timbre swap that #1916 exists for, and the LOUDNESS.
//
// The stub context's clock is a real clock. It has to be: the scheduler places
// bars against `ctx.currentTime` with a lookahead window, so a `currentTime`
// frozen at 0 would make it correctly decide there is nothing to arm yet, and
// every progression assertion below would be measuring the stub instead of the
// module. `vi.useFakeTimers()` fakes `Date` along with the timers, so the two
// advance together under `vi.advanceTimersByTime`.

type StubParam = {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  setTargetAtTime: ReturnType<typeof vi.fn>;
};

type StubOscillator = {
  type: string;
  frequency: StubParam;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  setPeriodicWave: ReturnType<typeof vi.fn>;
  /** The wave this oscillator was given, or `null` while it is a `type`. */
  wave: StubWave | null;
  onended: (() => void) | null;
};

/** What `createPeriodicWave` hands back — the coefficients, kept for #1920. */
type StubWave = { real: Float32Array; imag: Float32Array };

type StubBufferSource = {
  buffer: unknown;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
};

function stubParam(): StubParam {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
  };
}

/**
 * @param periodicWaves whether this engine can build a `PeriodicWave` at all.
 *   `false` is a real browser (and jsdom, and a context that refuses), and the
 *   pulse widths #1920 added have to degrade to the square rather than to
 *   silence there.
 */
function makeCtx(periodicWaves = true) {
  const oscillators: StubOscillator[] = [];
  const bufferSources: StubBufferSource[] = [];
  const gains: { gain: StubParam; connect: ReturnType<typeof vi.fn> }[] = [];
  const waves: StubWave[] = [];
  const close = vi.fn();
  const resume = vi.fn();
  const startedAt = Date.now();

  const createPeriodicWave = (real: Float32Array, imag: Float32Array): StubWave => {
    const wave: StubWave = { real, imag };
    waves.push(wave);
    return wave;
  };

  const ctx = {
    // Seconds since this context was made, off the faked `Date` — see the
    // header. A real AudioContext's clock runs; a stub whose clock does not is
    // a different module under test.
    get currentTime(): number {
      return (Date.now() - startedAt) / 1000;
    },
    state: "running" as AudioContextState,
    sampleRate: 48_000,
    destination: {} as AudioDestinationNode,
    close,
    resume,
    createGain: () => {
      const node = { gain: stubParam(), connect: vi.fn(), disconnect: vi.fn() };
      gains.push(node);
      return node;
    },
    createOscillator: () => {
      const node: StubOscillator = {
        type: "",
        frequency: stubParam(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        setPeriodicWave: vi.fn((wave: StubWave) => {
          // A real oscillator reports `"custom"` once a wave is set, and the
          // timbre assertions below read `type` — so the stub has to do the
          // same or a periodic-wave voice would still look like whatever it
          // was constructed as.
          node.type = "custom";
          node.wave = wave;
        }),
        wave: null,
        onended: null,
      };
      oscillators.push(node);
      return node;
    },
    createBuffer: (_channels: number, frames: number, _rate: number) => ({
      getChannelData: () => new Float32Array(frames),
    }),
    createBufferSource: () => {
      const node: StubBufferSource = {
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      bufferSources.push(node);
      return node;
    },
    ...(periodicWaves ? { createPeriodicWave } : {}),
  };

  return {
    ctx: ctx as unknown as AudioContext,
    oscillators,
    bufferSources,
    gains,
    waves,
    close,
    resume,
  };
}

/** How many lead notes one bar carries — read off the score, never hardcoded. */
const LEAD_STEPS = creditsBar(0).filter((event) => event.voice === "lead").length;

/** The lead line the scheduler has actually armed so far, chopped into bars. */
function leadBars(oscillators: readonly StubOscillator[]): number[][] {
  const pitches = oscillators
    .filter((osc) => osc.type === "square")
    .map((osc) => osc.frequency.value);
  const bars: number[][] = [];
  for (let i = 0; i + LEAD_STEPS <= pitches.length; i += LEAD_STEPS) {
    bars.push(pitches.slice(i, i + LEAD_STEPS));
  }
  return bars;
}

describe("startCreditsArpeggio (#1773)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("opens silent when the reader has already muted it", () => {
    // Not "mutes shortly after starting": the modal remembers the mute across
    // a close and reopen within a session, and a ramp-down from full volume
    // would play the first note anyway — which is the whole thing the reader
    // asked not to happen.
    const { ctx, gains } = makeCtx();

    startCreditsArpeggio(ctx, true);

    expect(gains[0]?.gain.value).toBe(0);
  });

  it("opens audible when it has not been muted", () => {
    // The positive control for the case above: without it, a master gain
    // hard-wired to zero would pass that one and ship a silent easter egg.
    const { ctx, gains } = makeCtx();

    startCreditsArpeggio(ctx, false);

    expect(gains[0]?.gain.value).toBeGreaterThan(0);
  });

  it("ramps to silence and back on the mute toggle", () => {
    const { ctx, gains } = makeCtx();
    const arpeggio = startCreditsArpeggio(ctx, false);
    const master = gains[0];

    arpeggio.setMuted(true);
    expect(master?.gain.setTargetAtTime).toHaveBeenCalledWith(0, 0, expect.any(Number));

    arpeggio.setMuted(false);
    // A RAMP back to an AUDIBLE target, not to whatever happened to be
    // there: asserting only that setTargetAtTime was called again would pass
    // on an unmute that ramps to zero.
    const calls = master?.gain.setTargetAtTime.mock.calls ?? [];
    expect(calls[calls.length - 1]?.[0]).toBeGreaterThan(0);
  });

  it("arms the next bar while it is running", () => {
    // The positive control for the teardown case below. Without it, a
    // scheduler that never re-armed at all would pass "no new voices after
    // stop" while being broken in the opposite direction.
    const { ctx, oscillators } = makeCtx();
    startCreditsArpeggio(ctx, false);
    const firstBar = oscillators.length;

    vi.advanceTimersByTime(5_000);

    expect(oscillators.length).toBeGreaterThan(firstBar);
  });

  it("stops scheduling, silences every voice and closes the context", () => {
    const { ctx, oscillators, close } = makeCtx();
    const arpeggio = startCreditsArpeggio(ctx, false);
    const armed = oscillators.length;
    expect(armed).toBeGreaterThan(0);

    arpeggio.stop();

    // Every voice already scheduled — including a note whose start time is
    // still in the future, which `onended` can never reach because a note
    // that has not begun never ends.
    for (const osc of oscillators) {
      expect(osc.stop).toHaveBeenCalled();
      expect(osc.disconnect).toHaveBeenCalled();
    }
    expect(close).toHaveBeenCalled();

    // And nothing re-arms. This is the leak: inaudible, because the context
    // is closed, and permanent, because the timer would keep re-arming for
    // as long as the tab lives.
    vi.advanceTimersByTime(30_000);
    expect(oscillators.length).toBe(armed);
  });

  it("survives a second stop and a mute after teardown", () => {
    // The component calls stop() from an effect AND from onCleanup, so the
    // double call is the normal path, not a defensive hypothetical.
    const { ctx, close } = makeCtx();
    const arpeggio = startCreditsArpeggio(ctx, false);

    arpeggio.stop();
    arpeggio.stop();
    arpeggio.setMuted(true);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("resumes a context the browser handed back suspended", () => {
    // Safari does this more often than Chromium, and a suspended context
    // schedules everything correctly while making no sound at all.
    const { ctx, resume } = makeCtx();
    (ctx as unknown as { state: AudioContextState }).state = "suspended";

    startCreditsArpeggio(ctx, false);

    expect(resume).toHaveBeenCalled();
  });
});

describe("the credits phrase (#1916)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("is several distinct bars long, and the PHRASE is the loop point", () => {
    // The complaint #1916 records is "it repeats too soon", so the thing to
    // prove is that the repeat is a phrase away and that the bars in between
    // are not each other. Proven on the score rather than on a frequency
    // list, so rewriting the tune costs nothing here.
    expect(BAR_COUNT).toBeGreaterThan(1);

    const shapes = new Set(
      Array.from({ length: BAR_COUNT }, (_unused, i) =>
        JSON.stringify(creditsBar(i).map((event) => [event.voice, event.hz, event.at])),
      ),
    );
    expect(shapes.size).toBe(BAR_COUNT);

    // ...and bar BAR_COUNT is bar 0 again: the wrap, which is what makes it a
    // phrase rather than a one-shot that runs out.
    expect(creditsBar(BAR_COUNT)).toEqual(creditsBar(0));
  });

  it("loops seconds out rather than the ~2 s that got it filed", () => {
    // A floor, not a pin: #1916 asked for "longer", the orchestrator's call
    // was ~8 s, and any future shortening back towards the 1.92 s bar this
    // replaced should have to argue with a red test first.
    expect(PHRASE_S).toBeCloseTo(BAR_COUNT * BAR_S);
    expect(PHRASE_S).toBeGreaterThan(7);
  });

  it("arms the bars in order instead of re-arming the first one", () => {
    // The scheduler half. `creditsBar` could walk a perfect progression while
    // the pump asked it for bar 0 every time, and every assertion above would
    // still be green.
    const { ctx, oscillators } = makeCtx();
    startCreditsArpeggio(ctx, false);

    vi.advanceTimersByTime((PHRASE_S + BAR_S) * 1000);

    const bars = leadBars(oscillators);
    expect(bars.length).toBeGreaterThan(BAR_COUNT);
    expect(bars[1]).not.toEqual(bars[0]);
    expect(bars[BAR_COUNT]).toEqual(bars[0]);
  });

  it("carries the lead on a pulse and the bass on the triangle", () => {
    // THE swap #1916 is about, and nothing else in the suite would notice a
    // revert to the #1773 triangle-over-sine-drone voicing.
    const { ctx, oscillators } = makeCtx();
    startCreditsArpeggio(ctx, false);

    const types = new Set(oscillators.map((osc) => osc.type));
    expect(types).toEqual(new Set(["square", "triangle"]));

    // And the pulse is the one ON TOP: a swap that put the square underneath
    // would satisfy the set above while sounding like a fog horn.
    const lead = oscillators.filter((o) => o.type === "square").map((o) => o.frequency.value);
    const bass = oscillators.filter((o) => o.type === "triangle").map((o) => o.frequency.value);
    expect(Math.min(...lead)).toBeGreaterThan(Math.max(...bass));
  });

  it("gives the percussion its own noise source, and stop() drops those too", () => {
    // A `createBufferSource` is not an `OscillatorNode`, so the teardown case
    // in the suite above walks straight past it: an untorn-down noise channel
    // would be exactly the leak that test exists to catch, and invisible to it.
    const { ctx, bufferSources } = makeCtx();
    const arpeggio = startCreditsArpeggio(ctx, false);
    expect(bufferSources.length).toBeGreaterThan(0);

    arpeggio.stop();

    for (const burst of bufferSources) {
      expect(burst.stop).toHaveBeenCalled();
      expect(burst.disconnect).toHaveBeenCalled();
    }
  });

  it("cannot get louder than the bar it replaced", () => {
    // MEASURED off the shipped score, not read off the comment in the module.
    //
    // Method: expand two whole phrases to events (two, so the loop seam is
    // inside the window), lay them on one timeline, and take the worst
    // instant — the sum of the envelope PEAKS of everything AUDIBLE there.
    // That is an UPPER BOUND on the rendered waveform rather than the waveform
    // itself, because |sine|, |square| and |triangle| are all ≤ 1; nothing
    // here renders audio, and neither jsdom nor node has an
    // OfflineAudioContext to render it with. It is computed the same way for
    // both sides of the comparison, so the bound is what is being compared.
    //
    // `decayS`, not `durS`: a note's source outlives its envelope, and summing
    // over the source's life makes every note overlap its successor by one
    // float ULP. Measured before that was fixed — the bound read 2.61 instead
    // of 1.41, i.e. it counted two leads and two basses that were, in reality,
    // 10⁻¹⁵ s apart.
    // #1920 — measured across EVERY movement, not just the opening one. The
    // suite spends its headroom differently per movement (a harmony line in
    // two of them, sixteenths in a third), so "the arrangement is under the
    // ceiling" is a claim about the loudest movement and nothing less.
    const worstOf = (movement: number): number => {
      const timeline: CreditsEvent[] = [];
      for (let bar = 0; bar < BAR_COUNT * 2; bar += 1) {
        for (const event of creditsBar(bar, movement)) {
          timeline.push({ ...event, at: bar * BAR_S + event.at });
        }
      }
      return Math.max(
        ...timeline.map((anchor) =>
          timeline
            .filter((event) => event.at <= anchor.at && anchor.at < event.at + event.decayS)
            .reduce((sum, event) => sum + event.peak, 0),
        ),
      );
    };

    const worstInstant = Math.max(
      ...Array.from({ length: MOVEMENT_COUNT }, (_unused, m) => worstOf(m)),
    );

    // The positive control. A single voice, or an arrangement whose voices
    // never overlap, would clear the ceiling below while proving nothing.
    expect(worstInstant).toBeGreaterThan(1);

    // #1773's worst instant, from the constants it shipped with: a lead note
    // at full envelope (peak 1) over the continuous A2 drone
    // (DRONE_GAIN / PEAK_GAIN = 0.025 / 0.06), times the master.
    const pre1916MixPeak = 0.06 * (1 + 0.025 / 0.06);
    expect(PEAK_GAIN * worstInstant).toBeLessThanOrEqual(pre1916MixPeak);
  });

  it("does not dump the missed bars at once when the tab was asleep", () => {
    // A backgrounded tab freezes `setTimeout` while the audio clock keeps
    // running. Without the resync in `pump`, the catch-up loop arms every bar
    // it missed, all with start times in the PAST, which WebAudio renders
    // immediately — fifteen bars at once, and the gain budget measured above
    // says nothing at all about that instant.
    const { ctx, oscillators } = makeCtx();
    startCreditsArpeggio(ctx, false);
    const oneBar = oscillators.length;
    expect(oneBar).toBeGreaterThan(0);

    // `setSystemTime` moves the clock WITHOUT running the timers — which is
    // precisely what a sleeping tab does to them.
    vi.setSystemTime(Date.now() + 30_000);
    vi.advanceTimersByTime(250);

    expect(oscillators.length).toBeLessThanOrEqual(oneBar * 2);
  });
});

describe("the credits suite (#1920)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  /** Every event of one whole movement, laid on a single timeline. */
  const movementEvents = (movement: number): CreditsEvent[] => {
    const out: CreditsEvent[] = [];
    for (let bar = 0; bar < BAR_COUNT; bar += 1) {
      for (const event of creditsBar(bar, movement)) {
        out.push({ ...event, at: bar * BAR_S + event.at });
      }
    }
    return out;
  };

  const voicesOf = (movement: number): Set<string> =>
    new Set(movementEvents(movement).map((event) => event.voice));

  it("is several movements long, and each one is its own music", () => {
    // The complaint is "the second pass sounds exactly like the first", so
    // what has to be proven is that the passes DIFFER. Proven on the score
    // rather than on a frequency list: rewriting a movement costs nothing
    // here, deleting the variety costs a red test.
    expect(MOVEMENT_COUNT).toBeGreaterThan(1);

    const shapes = new Set(
      Array.from({ length: MOVEMENT_COUNT }, (_unused, m) =>
        JSON.stringify(movementEvents(m).map((e) => [e.voice, e.hz, e.at, e.duty])),
      ),
    );
    expect(shapes.size).toBe(MOVEMENT_COUNT);

    // ...and the suite wraps rather than running out.
    expect(creditsBar(0, MOVEMENT_COUNT)).toEqual(creditsBar(0));
  });

  it("keeps every movement the same number of bars", () => {
    // `BAR_COUNT` and `PHRASE_S` are exported as if they described the whole
    // suite. They do — but only while the movements agree, and a movement that
    // ran long would be heard truncated at the roll's cycle anyway.
    for (let m = 0; m < MOVEMENT_COUNT; m += 1) {
      expect(creditsBar(BAR_COUNT, m)).toEqual(creditsBar(0, m));
    }
  });

  it("carries more voices than the lead-bass-drums #1916 shipped", () => {
    // "più voci" was the ask. The union across the suite must be strictly
    // bigger than what one movement carries, or the extra channels are
    // declared and never sounded.
    const union = new Set<string>();
    for (let m = 0; m < MOVEMENT_COUNT; m += 1) {
      for (const voice of voicesOf(m)) union.add(voice);
    }
    expect(union).toContain("lead");
    expect(union).toContain("bass");
    expect(union).toContain("harmony");
    expect(union).toContain("arp");
    expect(union.size).toBeGreaterThan(voicesOf(0).size);
  });

  it("never sounds the harmony and the arpeggio at once — they are ONE channel", () => {
    // The chip model is the reason the two are mutually exclusive rather than
    // both playing: a second pulse channel can do one or the other. A movement
    // carrying both would sound fuller and be a lie about the instrument, and
    // it would also blow the gain budget the loudness test measures.
    for (let m = 0; m < MOVEMENT_COUNT; m += 1) {
      const voices = voicesOf(m);
      expect(voices.has("harmony") && voices.has("arp")).toBe(false);
    }
  });

  it("keeps the harmony under the lead, in key, at every step", () => {
    // A "harmony" derived by transposing blindly would be in the right place
    // and the wrong key. Every harmony note must be a chord tone below the
    // lead note sounding at the same instant — the pitch-class check is what
    // says "in key", the comparison is what says "underneath".
    for (let m = 0; m < MOVEMENT_COUNT; m += 1) {
      const events = movementEvents(m);
      const harmonies = events.filter((e) => e.voice === "harmony");
      for (const harmony of harmonies) {
        const lead = events.find((e) => e.voice === "lead" && e.at === harmony.at);
        expect(lead?.hz).toBeDefined();
        expect(harmony.hz ?? 0).toBeLessThan(lead?.hz ?? 0);
      }
    }
  });

  it("follows the roll: the movement turns over when the titles come back round", () => {
    // THE thing #1920 exists for. The scheduler could walk a perfect suite
    // while ignoring the accessor entirely, and every assertion above would
    // still be green.
    let pass = 0;
    const { ctx, oscillators } = makeCtx();
    startCreditsArpeggio(ctx, false, () => pass);

    vi.advanceTimersByTime(PHRASE_S * 1000);
    const opening = oscillators.map((osc) => osc.frequency.value);
    expect(opening.length).toBeGreaterThan(0);

    // The roll wraps. The next bar armed must come from movement one.
    pass = 1;
    const beforeSwitch = oscillators.length;
    vi.advanceTimersByTime(BAR_S * 2 * 1000);
    const after = oscillators.slice(beforeSwitch).map((osc) => osc.frequency.value);

    expect(after.length).toBeGreaterThan(0);
    // Not "some note differs": the whole bar has to be a bar the opening
    // movement never plays, which is what a progression change means.
    const openingBars = Array.from({ length: BAR_COUNT }, (_unused, b) =>
      JSON.stringify(creditsBar(b, 0).map((e) => e.hz)),
    );
    const armed = JSON.stringify(creditsBar(0, 1).map((e) => e.hz));
    expect(openingBars).not.toContain(armed);
    expect(after.some((hz) => !opening.includes(hz))).toBe(true);
  });

  it("re-enters the new movement at its FIRST bar, not wherever the old one was", () => {
    // Otherwise the turn-over lands mid-phrase and reads as a glitch rather
    // than as a new movement. `creditsBar(0, 1)`'s lead is the tell.
    let pass = 0;
    const { ctx, oscillators } = makeCtx();
    startCreditsArpeggio(ctx, false, () => pass);

    // Three bars into the opening movement, so "bar 0" cannot be a coincidence.
    vi.advanceTimersByTime(BAR_S * 3 * 1000);
    pass = 1;
    const mark = oscillators.length;
    vi.advanceTimersByTime(BAR_S * 1000);

    const armedLead = oscillators
      .slice(mark)
      .filter((osc) => osc.type === "custom" || osc.type === "square")
      .map((osc) => osc.frequency.value);
    const wanted = creditsBar(0, 1)
      .filter((e) => e.voice === "lead")
      .map((e) => e.hz ?? 0);

    for (const hz of wanted) expect(armedLead).toContain(hz);
  });

  it("survives an accessor that throws or answers with nonsense", () => {
    // The accessor reaches into the DOM for an animation that may not be
    // there. A throw inside the pump would kill the timer and take the whole
    // soundtrack with it, silently — and NaN would index no movement at all.
    const { ctx, oscillators } = makeCtx();
    startCreditsArpeggio(ctx, false, () => {
      throw new Error("no animation");
    });
    vi.advanceTimersByTime(BAR_S * 2 * 1000);
    expect(oscillators.length).toBeGreaterThan(0);

    const nonsense = makeCtx();
    startCreditsArpeggio(nonsense.ctx, false, () => Number.NaN);
    vi.advanceTimersByTime(BAR_S * 2 * 1000);
    expect(nonsense.oscillators.length).toBeGreaterThan(0);
    expect(nonsense.oscillators.every((osc) => Number.isFinite(osc.frequency.value))).toBe(true);
  });

  it("renders the narrow pulse widths as periodic waves", () => {
    // "più chiptune" is mostly this: a 25% or 12.5% pulse is what hardware
    // sounds like, and `OscillatorNode` has no such type. Sampled at a pass
    // that uses one, so a suite that declared widths and never built a wave
    // fails here.
    let pass = 0;
    const { ctx, oscillators, waves } = makeCtx();
    startCreditsArpeggio(ctx, false, () => pass);
    pass = 1;
    vi.advanceTimersByTime(BAR_S * 2 * 1000);

    expect(waves.length).toBeGreaterThan(0);
    expect(oscillators.some((osc) => osc.type === "custom")).toBe(true);

    // Built ONCE per width and shared: a wave per note would be hundreds of
    // identical immutable objects a minute.
    const distinct = new Set(oscillators.filter((o) => o.wave !== null).map((o) => o.wave));
    expect(distinct.size).toBeLessThanOrEqual(waves.length);
    expect(waves.length).toBeLessThanOrEqual(4);
  });

  it("leaves the opening movement on the built-in square", () => {
    // Movement one is #1916's phrase and #1916's timbre, deliberately: the
    // first pass of the titles is the one everybody sees, and a 50% pulse
    // rebuilt from 24 harmonics is a ringing approximation of a wave the
    // engine already has exactly.
    const { ctx, oscillators, waves } = makeCtx();
    startCreditsArpeggio(ctx, false);
    vi.advanceTimersByTime(BAR_S * 2 * 1000);

    expect(waves.length).toBe(0);
    expect(new Set(oscillators.map((osc) => osc.type))).toEqual(new Set(["square", "triangle"]));
  });

  it("falls back to the square when the engine cannot build a wave", () => {
    // An engine with no `createPeriodicWave` (and a context that refuses one)
    // must lose the WIDTH, not the note. Silence here would be a movement that
    // simply stops playing on older Safari.
    let pass = 0;
    const { ctx, oscillators } = makeCtx(false);
    startCreditsArpeggio(ctx, false, () => pass);
    pass = 2;
    vi.advanceTimersByTime(BAR_S * 2 * 1000);

    expect(oscillators.length).toBeGreaterThan(0);
    expect(oscillators.every((osc) => osc.type === "square" || osc.type === "triangle")).toBe(true);
  });
});
