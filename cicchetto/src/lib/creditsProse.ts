// #1924 — the prose the credit roll carries between one pass and the next.
//
// The roll is a column, and this block sits in it directly under the
// contributor list. That placement is the whole trick asked for: while the
// names are leaving through the top of the viewport the paragraph is already
// entering through the bottom, so nothing waits for the titles to scroll away
// and there is no second screen to cut to.
//
// The TEXT is versioned here rather than fetched, and that is deliberate: it
// is part of the bundle the credits describe. A build claims a sha, a date and
// a contributor list; the words it shows about itself belong to the same
// artifact, not to a CMS that could answer differently to two people looking
// at the same build.
//
// Registers are mixed ON PURPOSE and the deck does not separate them: the
// manifesto sets state why the thing exists, the anecdote sets are lifted from
// posts already published on sindro.me. Alternating them by rule would make
// the sequence predictable, which is the one thing a title sequence you watch
// twice cannot afford.

/**
 * One set: a title and the paragraphs shown under it on a single pass.
 *
 * Two or three paragraphs, each a few short sentences. The ceiling is not
 * decorative — the roll travels a fixed distance in a fixed time, so a long
 * set does not scroll slower, it scrolls PAST. `creditsProse.test.ts` pins the
 * bound rather than trusting the eye of whoever adds the next one.
 */
export type ProseSet = {
  readonly title: string;
  readonly paragraphs: readonly string[];
};

/** The longest a set may be before the roll outruns a reader. */
export const PROSE_SET_MAX_WORDS = 150;

export const CREDITS_PROSE: readonly ProseSet[] = [
  {
    title: "information wants to be free",
    paragraphs: [
      "Information wants to be free. It always did. The wire does not care what you send down it. Only the owner of the wire cares.",
      "So do not hand your words to an owner. Type them into a room. Let them be read, quoted, logged, grepped.",
      "A message you cannot copy is not a message. It is a rental.",
    ],
  },
  {
    title: "free software",
    paragraphs: [
      "Free software is not free of charge. It is free of landlords.",
      "Every line of this is readable. Changeable. Runnable on a five-euro machine that answers to you, in a country you picked, under a name you invented.",
      "There is no account here for a company to close. Fork it and the network outlives you.",
    ],
  },
  {
    title: "old software that works",
    paragraphs: [
      "IRC was finished in 1988. It still runs.",
      "No reactions. No read receipts. No typing indicator. No algorithm deciding which friend you see today. Those are not missing features. They are refusals.",
      "Old code that still works is not debt. It is proof. Most of what came after was an attention tax with a logo on it.",
    ],
  },
  {
    title: "text is the feature",
    paragraphs: [
      "Text is the feature, not the limit.",
      "A screen reader reads a channel line by line and loses nothing. A grep finds a conversation from 2003. A train tunnel renders it in bytes. Your head does the rest, the way it did for MUDs.",
      "More pixels per second is not more signal.",
    ],
  },
  {
    title: "the pseudonym",
    paragraphs: [
      "Behind every nick there is a person who chose that name.",
      "Not a phone number. Not a legal name. Not a verified badge. A word you picked, typed into a room full of other picked words, until the words turned into friendships, projects and jobs.",
      "That is the whole protocol. Everything else is transport.",
    ],
  },
  {
    title: "whose infrastructure",
    paragraphs: [
      "You cannot read the code of the app you talk to your friends in. You cannot change it, you cannot run it yourself, and you cannot take it with you.",
      "You rent a seat on somebody else's stage, and they keep the right to rearrange the stage while you sit on it.",
      "IRC runs on a cheap server, a handful of text files and a small program. That asymmetry is not decoration. It is the whole game.",
    ],
  },
  {
    title: "teaching a server to lie",
    paragraphs: [
      "2001. Azzurra ran a commercial IRC server, because it shipped a Java applet, and the applet was how half the users got in.",
      "The applet sent GUEST on connect and waited for the right numerics back. That was the protection.",
      "So we taught Bahamut to answer CR1.8.4-SEC with a straight face, and dropped the commercial server. The applet never noticed.",
    ],
  },
  {
    title: "you existed only while connected",
    paragraphs: [
      "On IRC in 2002 you existed only while connected. Ping timeout: 180 seconds, and your name was up for grabs.",
      "People left tower PCs humming all night, phone line tied up, to hold a nickname while they slept. The luckier ones rented a psyBNC.",
      "Your identity required physical infrastructure. This bouncer is that tower PC, minus the noise.",
    ],
  },
  {
    title: "netsplit",
    paragraphs: [
      "A netsplit is when the network forgets it is one network. Two halves, both convinced they are the real one, the same nickname alive in each.",
      "IRC's answer was scorched earth: disconnect both users and let them sort it out. The attacker reconnected instantly. The victim came back to find the name gone.",
      "The fix was a timestamp. Oldest claim wins. Twenty-four years later it still holds.",
    ],
  },
  {
    title: "twenty-one",
    paragraphs: [
      "At twenty-one I forked an IRC server to teach it IPv6 and SSL. At night. For a network that paid nobody.",
      "The CVS repository is still on SourceForge. 171 commits, three authors, February 2002 to January 2006.",
      "It still compiles, and not because I wrote it well: Sonic and morph kept their hands on it for twenty years. Left alone it would have rotted like everything else from 2002.",
    ],
  },
  {
    title: "the trail goes cold",
    paragraphs: [
      "In 2002 I started writing IRC services from scratch. 954 commits. I left the network before they were finished.",
      "A developer in Latvia picked them up, wrote 192 commits, and then the trail goes cold. I never learned their name.",
      "That is open source. You put it down, somebody else picks it up, and the thing keeps walking without you.",
    ],
  },
  {
    title: "#sniffo",
    paragraphs: [
      "The channel was called #sniffo. Inline skating and funny faces. Nothing pharmaceutical.",
      "Three teenagers on a Monopoli-Milan-Bologna axis met there, then drove across the country to sit in the same room with the case open and the CRTs on.",
      "Twenty-five years later the channel is still there. So are they.",
    ],
  },
  {
    title: "the bot",
    paragraphs: [
      "The bot in this channel started as a line somebody threw out in passing: you should try hooking Claude up to IRC directly. Five minutes later it was online.",
      "First night, 250 lines of Python: it corrected a factual error in a blog post, deployed the fix while the channel was still arguing about it, caught two prompt injections, and leaked its operator's brokerage account number. Twice.",
      "Then it learned to shut up until spoken to. That was the hard part.",
    ],
  },
  {
    title: "found in a magazine",
    paragraphs: [
      "I found IRC in a magazine. Paper, a newsstand, an article about an Italian network.",
      "I connected, picked a name, opened a channel with friends. User, then contributor, then operator, then writing the server itself. None of it planned.",
      "No algorithm was involved. Somebody wrote something down and somebody else read it.",
    ],
  },
  {
    title: "eighteen years",
    paragraphs: [
      "In 2008 a friend told me: get yourself a Facebook, it is like IRC but it does so much more.",
      "He was right. It did so much more. Then it did stories, and reels, and an algorithm, and eighteen years went past.",
      "I came back in 2026. Same people, same channels, same names. Nobody had monetised anything.",
    ],
  },
  {
    title: "how this channel filled up",
    paragraphs: [
      "In April there was one person in this channel. Me, plus a bot I had wired up the week before.",
      "Then guly joined. Then peluche, who stayed. Then nextime sent the first contributions from outside. Then Hypnotize, then Sonic, then Lucy, building Resentin against the same API.",
      "Nobody was recruited. They read something somewhere and typed /join.",
    ],
  },
];

/** Draws sets in an order that looks random and behaves better than random. */
export type ProseDeck = {
  /** The set for the pass that is starting now, or `null` from an empty pool. */
  draw(): ProseSet | null;
};

/**
 * Fisher-Yates over the indices of `count` items.
 *
 * Indices rather than the sets themselves so the deck never copies the prose,
 * and so a test can assert the ORDER without comparing paragraphs.
 */
function shuffledIndices(count: number, random: () => number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    // `j` can land on `i` itself, which is a no-op swap and a legitimate
    // outcome — clamping it away would bias the shuffle.
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  return order;
}

/**
 * A shuffle bag, not `Math.random()` per pass.
 *
 * Uniform sampling is the wrong tool for a sequence somebody WATCHES: with
 * sixteen sets it repeats the one you just read about one pass in sixteen, and
 * a title sequence that shows the same paragraph twice in a row does not read
 * as chance, it reads as a bug. The bag deals every set once before
 * reshuffling, and the reshuffle refuses to open on the set the previous bag
 * closed with, so back-to-back repeats are impossible rather than merely
 * unlikely.
 *
 * @param sets the pool to deal from; an empty pool deals `null` forever
 * @param random the source of randomness, injected so tests are deterministic
 */
export function createProseDeck(
  sets: readonly ProseSet[] = CREDITS_PROSE,
  random: () => number = Math.random,
): ProseDeck {
  let bag: number[] = [];
  let last: number | null = null;

  const refill = (): void => {
    bag = shuffledIndices(sets.length, random);
    // Only meaningful from two sets up: with one set every pass shows it, and
    // with none there is nothing to swap.
    if (sets.length > 1 && bag[bag.length - 1] === last) {
      const other = bag.length - 2;
      [bag[bag.length - 1], bag[other]] = [bag[other] as number, bag[bag.length - 1] as number];
    }
  };

  return {
    draw(): ProseSet | null {
      if (sets.length === 0) return null;
      // Dealt from the END so a draw is a pop rather than a shift — the order
      // is already random, so which end it comes off is free.
      if (bag.length === 0) refill();
      const index = bag.pop() as number;
      last = index;
      return sets[index] as ProseSet;
    },
  };
}

/** Words in a set, title included, counted the way the bound is written. */
export function proseSetWords(set: ProseSet): number {
  return [set.title, ...set.paragraphs].join(" ").split(/\s+/).filter(Boolean).length;
}
