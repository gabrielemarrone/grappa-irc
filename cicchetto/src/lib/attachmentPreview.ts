import type { MediaKind } from "./mediaLink";
import { splitLines } from "./textResource";
import { baseMime, categoryOf } from "./uploadCategory";

// #1964 — what a STAGED LOCAL file can be shown as in the upload confirm, and
// how to read the head of a text one.
//
// #1883 shipped the confirm with an image-only thumbnail, on the argument that
// "a picture is the only preview worth showing: for every other category the
// bytes say nothing a human can check at a glance, and the name is what
// distinguishes contract-final.pdf from contract-draft.pdf". That argument
// assumes a file the OPERATOR named. On the paste path (#816) the name is the
// constant `paste.txt` for every paste in every window, so the one signal the
// design leans on carries zero bits, and the dialog asks the operator to
// authorise an upload they cannot see. Gabriele's ruling (2026-09-08): show the
// preview for the file's ACTUAL type, reusing the wiring that already exists.
//
// ## The vocabulary is the viewer's, not a second one
//
// `MediaKind` ("image" | "video" | "audio" | "text") is what `mediaLink.ts`
// classifies a clicked scrollback link into and what `MediaViewerModal`
// switches on. A staged local file poses the same question — what element can
// render this — so it gets the same four answers rather than a parallel set.
// The confirm row then reuses the viewer's element shapes (an `<img>`, a muted
// `<video>`, an `<audio controls>`, a `<pre>` of lines), which is why this maps
// INTO `MediaKind` instead of exporting a private union.
//
// ## Why the map is not `categoryOf` alone
//
// `UploadCategory` has four members too, and three of them line up. The fourth
// does not: `document` is one bucket holding `text/plain`, `text/markdown`,
// PDF, ODT, ODS, DOCX and XLSX. Only the two text types have a renderer here —
// there is no PDF or office renderer anywhere in cic, and inventing one for a
// 2.5rem confirm row would be a new viewer, not a reuse. So `document` splits
// on the base MIME and everything unrenderable answers `null`, which keeps the
// existing neutral placeholder for exactly the files that have nothing to show.
//
// ## Not a scrollback preview
//
// CLAUDE.md's "IRC stays text only" bans inline rendering of media in
// SCROLLBACK. This is a modal the operator opened by staging a file, showing a
// file that is still on their own disk — the same slot #1883 already put an
// image thumbnail in. Nothing here renders anything that arrived over IRC.

/**
 * What can this staged file be shown as, if anything?
 *
 * * `image` / `video` / `audio` — the upload category answers directly.
 * * `text` — only `text/plain` and `text/markdown` out of the `document`
 *   bucket; PDF and the office types have no renderer and answer `null`.
 * * `null` — nothing to show; the row keeps its neutral placeholder.
 *
 * Parameter-tolerant via `baseMime`, so the paste path's
 * `text/plain; charset=utf-8` (#1256) is recognised.
 */
export function previewKindOf(mime: string): MediaKind | null {
  const category = categoryOf(mime);
  switch (category) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "document":
      return TEXT_MIMES.has(baseMime(mime)) ? "text" : null;
    case null:
      return null;
  }
}

// The renderable slice of the `document` bucket. A Set of base MIMEs rather
// than a suffix test on `text/`: `uploadCategory` admits exactly these two
// text types, and a `text/*` test would claim types the upload itself refuses.
const TEXT_MIMES: ReadonlySet<string> = new Set(["text/plain", "text/markdown"]);

/** Rows shown in a confirm-row text preview. Enough to recognise a paste. */
export const TEXT_PREVIEW_LINES = 4;

// How much of the file to read for those rows. The preview is a HEAD, so the
// read is a head too: a staged text upload may be megabytes (the document cap
// is far above this), and `Blob.text()` on the whole of it would decode all of
// it to show four lines. 8 KiB holds four lines of anything an operator pastes,
// by orders of magnitude.
const TEXT_PREVIEW_MAX_BYTES = 8 * 1024;

/**
 * Read the first `maxLines` lines of a text blob for the preview.
 *
 * Never throws: an unreadable blob answers `[]` and the row falls back to its
 * placeholder. A dialog that has to say something about a file must not be the
 * thing that breaks when the file is odd.
 */
export async function readTextPreview(blob: Blob, maxLines: number): Promise<string[]> {
  const head = blob.slice(0, TEXT_PREVIEW_MAX_BYTES);
  let text: string;
  try {
    text = await head.text();
  } catch {
    return [];
  }

  const lines = splitLines(text);
  // A byte slice can land mid-line AND mid-codepoint (UTF-8 decode leaves a
  // U+FFFD there), so the last row of a truncated read is not a line the file
  // has — drop it. `splitLines` already drops the phantom row a trailing
  // newline produces, so this only fires on a genuine cut.
  if (head.size < blob.size) lines.pop();
  return lines.slice(0, maxLines);
}
