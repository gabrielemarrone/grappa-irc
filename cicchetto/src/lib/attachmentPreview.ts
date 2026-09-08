import type { MediaKind } from "./mediaLink";
import { splitLines } from "./textResource";
import {
  baseMime,
  categoryOf,
  type DOCUMENT_MIMES_OFFICE,
  type DOCUMENT_MIMES_PORTABLE,
} from "./uploadCategory";

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
    // Widened lookup, the shape `mimeExtLabel` uses: the map is keyed on the
    // MIME unions so it cannot drift, but the caller holds a bare string.
    case "document": {
      const documents = DOCUMENT_PREVIEW_KIND as Readonly<Record<string, MediaKind | null>>;
      return documents[baseMime(mime)] ?? null;
    }
    case null:
      return null;
  }
}

// What each member of the `document` bucket can be shown as — and it is keyed
// on the MIME UNIONS rather than being a set of strings, so a ninth document
// type added to `uploadCategory` is a compile error here instead of a file
// that silently previews as an empty box. Same discipline, and for the same
// stated reason, as `MIME_EXT_LABEL` in that module ("so a 15th MIME added to
// a list without a label here is a compile error").
//
// `null` is a decision, not an omission: cic has no PDF renderer and no office
// renderer, and this slice reuses viewers rather than inventing them.
const DOCUMENT_PREVIEW_KIND: Record<
  (typeof DOCUMENT_MIMES_PORTABLE)[number] | (typeof DOCUMENT_MIMES_OFFICE)[number],
  MediaKind | null
> = {
  "application/pdf": null,
  "text/plain": "text",
  "text/markdown": "text",
  "application/vnd.oasis.opendocument.text": null,
  "application/vnd.oasis.opendocument.spreadsheet": null,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": null,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": null,
};

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
  // U+FFFD there), so a truncated read's last row may not be a line the file
  // has. Two guards, and each answers a case that showed the operator LESS
  // than the truth:
  //
  //   * `endsWith("\n")` — a cut landing exactly on a line boundary leaves
  //     every row complete, and `splitLines` has already dropped the phantom
  //     row the trailing newline produces. Popping there eats a real line.
  //   * `length > 1` — a file whose FIRST line is longer than the head read (a
  //     minified blob renamed `.txt`, a single-line log record) yields one
  //     partial row, and popping it returns `[]`: an empty preview box, which
  //     is the exact defect #1964 exists to remove. A truncated first line is
  //     worth more than nothing.
  if (head.size < blob.size && !text.endsWith("\n") && lines.length > 1) lines.pop();
  return lines.slice(0, maxLines);
}
