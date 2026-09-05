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

/**
 * The longest a set may be before the roll outruns a reader.
 *
 * Raised from 150 after the first pass of copy review: several sets were
 * saying the technical half of a thing and leaving the half a non-technical
 * reader needs on the floor, because the bound had no room for it. 300 buys
 * that room. It is still a bound — the roll travels a fixed distance in a
 * fixed time, and a set that outgrows this does not scroll slower, it scrolls
 * past.
 */
export const PROSE_SET_MAX_WORDS = 300;

export const CREDITS_PROSE: readonly ProseSet[] = [
  {
    title: "information wants to be free",
    paragraphs: [
      "Information wants to be free. The line gets quoted as if it meant free of charge. It never did. It means that something known costs nothing to pass on, and that every wall built to stop it is somebody's business model rather than a law of nature.",
      "Copyleft is that sentence written down as a licence: take this, change it, pass it on, and pass on the same permission you were given. It is the difference between a garden you are allowed to walk in and a garden you are allowed to plant in. The walled kind can be pleasant. It is still not yours, and the gate only opens one way.",
      "The wire does not care what you send down it. Only the owner of the wire cares. So write where nobody owns the wire.",
    ],
  },
  {
    title: "free software",
    paragraphs: [
      "Free software is not free of charge. It is free of landlords.",
      "Eric Raymond gave the two ways of building it their names: the cathedral and the bazaar. The cathedral is raised behind a closed door by appointed hands and handed down finished. The bazaar is a crowd, in the open, arguing in public, everybody free to take the work home and bring back something better. The bazaar should not work. It wrote this protocol, and most of what your bank runs on.",
      "Every line of this is readable, changeable, runnable on a five-euro machine that answers to you, in a country you picked, under a name you invented. There is no account here for a company to close. Fork it and the community outlives you.",
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
      "A screen reader speaks a channel out loud, line by line, and loses nothing on the way. A search box finds a conversation from 2003 before you have finished typing the word you remember. A phone with one bar in a tunnel still delivers it, because a sentence weighs almost nothing. Your head supplies the rest, the way it does with a novel.",
      "More features, more images, more little sounds: none of that is more signal. It is more distraction, handed to you as though it were generosity.",
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
    title: "the room you rent",
    paragraphs: [
      "You cannot read the code of the app you talk to your friends in. You cannot change it, you cannot run it yourself, and you cannot take it with you when you go.",
      "You rent a room in somebody else's building. Rearranging it is not on offer. You move around inside the limits they set, and they redraw those limits whenever it suits them: no notice, no appeal, no forwarding address for the conversations that were in there.",
      "IRC runs on a cheap server, a handful of text files and a small program. Anyone can stand one up in an afternoon and hold the keys to it. That asymmetry is not decoration. It is the whole game.",
    ],
  },
  {
    title: "teaching a server to lie",
    paragraphs: [
      "2001. Azzurra was paying for a commercial IRC server it did not want, and could not drop, because of the little chat window on the website: click, type a name, you are in, nothing to install. Half the network arrived that way.",
      "That window was fussy about its host. On connecting it asked the server what it was, and it would only go on if the answer came back word for word as the product it had been sold with: CR1.8.4-SEC.",
      "So we taught our own free server to give exactly that answer, with a straight face, and dropped the commercial one. The window never noticed. Neither did the people typing into it.",
    ],
  },
  {
    title: "you existed only while connected",
    paragraphs: [
      "On IRC you exist only while connected. Close the window and the room carries on without you: nothing is kept, nothing is waiting when you come back, and whatever was said while you were away was said to the people who were there. That is not a gap in the protocol. It is what the protocol is, in 1988 and still in 2026.",
      "So people left tower PCs running all night, phone line tied up, purely to stay in the room. The luckier ones rented a psyBNC: a small program on somebody's always-on machine that held the connection in your place and handed you the transcript when you got back.",
      "grappa is that program, grown up and pointed at everyone rather than at the fifteen people who knew how to install one. It holds the line, keeps the conversation, and lets you walk away from the desk. Being present stops being a function of your electricity bill.",
    ],
  },
  {
    title: "netsplit",
    paragraphs: [
      "A netsplit is the moment the network forgets it is one network. A link between two servers dies and each half carries on convinced it is the whole thing: same channels, same names, two of everything, neither aware of the other.",
      "From the inside it looks like the room being cut in half in one line. *** Netsplit hub.azzurra.chat <-> irc.azzurra.chat — and half the people you were mid-argument with are simply gone. Ninety seconds later: *** Netjoin, and they all walk back in at once and finish the sentence, having spent the interval in a room that was also #sniffo, with the same topic, and no idea you were missing.",
      "The ugly part came at the seam. The same nickname was alive on both sides, and IRC settled it by killing both claims — the attacker who caused the split reconnected instantly, the person who had held the name for years came back to find it gone. The fix was a timestamp: oldest claim wins. Twenty-four years later it still holds.",
    ],
  },
  {
    title: "twenty-one",
    paragraphs: [
      "At twenty-one I forked an IRC server to teach it IPv6 and SSL. At night. For a network that paid nobody.",
      "The CVS repository is still on SourceForge: 171 commits, three authors, February 2002 to January 2006. It still compiles today, which is not a compliment to my code.",
      "It compiles because Sonic and morph kept their hands on it, on and off, for twenty years — not heroics, not a commit a day, just two volunteers who kept answering for a thing nobody was paying them to keep alive, until Bahamut and Azzurra were still standing in 2026. Open source does not survive because the code is good. It survives because somebody keeps turning up.",
    ],
  },
  {
    title: "the trail goes cold",
    paragraphs: [
      "In 2002 I started writing IRC services from scratch — the programs that hold your nickname while you are away, so that a name is yours rather than whoever types it first. 954 commits. I left the network before they were finished.",
      "Aidas Kasparas picked them up from Latvia, signing his work monas, and wrote 192 commits more. Then that trail goes cold as well. Nobody runs the code today.",
      "But while the two of us were on it the trail was hot, and what each of us kept was never the software: it was the hands-on knowledge of having built the thing, which does not go cold at all. The process was the product. It usually is.",
    ],
  },
  {
    title: "#sniffo",
    paragraphs: [
      "The channel was called #sniffo. Inline skating and funny faces. Nothing pharmaceutical.",
      "What gathered there was a loosely-knit group of nerds on the Milan-Bologna-Monopoli axis, which is most of the length of the country. Nobody organised it and nobody counted. In time they started driving that axis for real, to sit in the same room with the cases open and the CRTs on, arguing about the same code they had been arguing about in text all year.",
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
      "That is the trick open source keeps pulling, and no algorithm is involved anywhere in it: somebody writes something down, somebody else reads it and ends up contributing, and a great many people who will never touch the code get the benefit of both. One article in a magazine, and here we still are.",
    ],
  },
  {
    title: "eighteen years",
    paragraphs: [
      "In 2008 a friend told me: come to the social network, it is like IRC but it does so much more.",
      "He was right. It did so much more. Then it did stories, and reels, and an algorithm deciding which friend I saw today, and eighteen years went past.",
      "I came back to IRC in 2026, and by an absurd route: doing digital archaeology with an AI on code I had left rotting in time capsules, SourceForge CVS repositories nobody had touched since 2006. I rejoined Azzurra. Hypnotize queried me within minutes, and I was back on the operators' channel as though twenty years had not happened. Same people, same channels, same names. Nobody had monetised anything.",
    ],
  },
  {
    title: "how this channel filled up",
    paragraphs: [
      "In April there was one person in this channel. Me, plus a bot I had wired up the week before.",
      "Then guly joined. Then peluche, who stayed, and who has been on every build since — the one who finds in ten minutes, by using the thing like a person rather than like its author, what no test suite was ever going to catch. Then nextime sent the first contributions from outside. Then Hypnotize, then Sonic, then morph, who arrived for the server he had been maintaining for twenty years and fell for the client instead. Then Lucy, building Resentin against the same API, because the API is open and nobody had to ask.",
      "Nobody was recruited. They read something somewhere and typed /join. Now we're thirty.",
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
