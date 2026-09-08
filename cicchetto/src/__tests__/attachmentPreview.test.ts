import { describe, expect, it } from "vitest";
import { previewKindOf, readTextPreview, TEXT_PREVIEW_LINES } from "../lib/attachmentPreview";

// #1964 — what a staged local file can be shown as in the upload confirm.
//
// The defect this covers is not "a missing feature": #1883's row answered a
// thumbnail for images and NOTHING for every other type, and the paste path
// (#816) names every file `paste.txt`, so the one dialog that exists to show
// the operator what is going out showed a constant name, a byte count and an
// empty box.

describe("previewKindOf (#1964)", () => {
  it("answers the media viewer's own kind for the three element-backed categories", () => {
    expect(previewKindOf("image/png")).toBe("image");
    expect(previewKindOf("image/webp")).toBe("image");
    expect(previewKindOf("video/mp4")).toBe("video");
    expect(previewKindOf("video/quicktime")).toBe("video");
    expect(previewKindOf("audio/mpeg")).toBe("audio");
    expect(previewKindOf("audio/flac")).toBe("audio");
  });

  // The `document` category is one bucket holding text AND formats with no
  // renderer anywhere in cic. Splitting it is the whole reason this function
  // is not just `categoryOf`.
  it("splits the document bucket: text renders, PDF and office do not", () => {
    expect(previewKindOf("text/plain")).toBe("text");
    expect(previewKindOf("text/markdown")).toBe("text");
    expect(previewKindOf("application/pdf")).toBeNull();
    expect(previewKindOf("application/vnd.oasis.opendocument.text")).toBeNull();
    expect(
      previewKindOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBeNull();
  });

  // #1256 — the paste path declares its encoding, so the type carries a
  // parameter. An exact-string map would answer null for the ONE file this
  // whole issue is about.
  it("is parameter-tolerant, so the paste path's charset-bearing type is text", () => {
    expect(previewKindOf("text/plain; charset=utf-8")).toBe("text");
    expect(previewKindOf("IMAGE/PNG")).toBe("image");
  });

  it("answers null for a type the upload itself would refuse", () => {
    expect(previewKindOf("application/octet-stream")).toBeNull();
    expect(previewKindOf("")).toBeNull();
  });
});

describe("readTextPreview (#1964)", () => {
  const blob = (text: string): Blob => new Blob([text], { type: "text/plain" });

  it("returns the first lines, capped", async () => {
    const lines = await readTextPreview(blob("a\nb\nc\nd\ne\nf"), TEXT_PREVIEW_LINES);
    expect(lines).toEqual(["a", "b", "c", "d"]);
  });

  it("handles CRLF and a file shorter than the cap", async () => {
    expect(await readTextPreview(blob("a\r\nb"), TEXT_PREVIEW_LINES)).toEqual(["a", "b"]);
  });

  // `splitLines` drops the phantom row a trailing newline would produce, so a
  // file ending in \n does not preview a blank last line.
  it("does not show the phantom line of a file ending in a newline", async () => {
    expect(await readTextPreview(blob("a\nb\n"), TEXT_PREVIEW_LINES)).toEqual(["a", "b"]);
  });

  it("an empty file previews one empty line, not a crash", async () => {
    expect(await readTextPreview(blob(""), TEXT_PREVIEW_LINES)).toEqual([""]);
  });

  // The read is a HEAD read, so the last row of a cut may not be a line the
  // file has — and on a byte boundary it may not even be valid UTF-8.
  it("drops the partial last line when the file is longer than the head read", async () => {
    const lines = await readTextPreview(
      blob(`first\n${"x".repeat(16 * 1024)}`),
      TEXT_PREVIEW_LINES,
    );
    expect(lines).toEqual(["first"]);
  });

  // …but "drop the last row" has two cases where it would show LESS than the
  // truth, and both were live until the #1964 review.
  //
  // A file whose first line is longer than the head read yields exactly ONE
  // partial row, and dropping it returns [] — an empty preview box, which is
  // the defect this whole module exists to remove.
  it("keeps a truncated first line rather than previewing nothing", async () => {
    const lines = await readTextPreview(blob("z".repeat(9000)), TEXT_PREVIEW_LINES);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(8 * 1024);
  });

  // And a cut that lands exactly ON a line boundary leaves every row complete:
  // splitLines has already dropped the phantom the trailing newline makes, so
  // dropping again eats a real line. Four 2048-byte lines fill the 8 KiB head
  // exactly, and the tail past it is what makes the read a cut.
  it("does not eat a line when the cut lands on a line boundary", async () => {
    const line = (c: string): string => `${c.repeat(2047)}\n`;
    const text = `${line("a")}${line("b")}${line("c")}${line("d")}tail`;
    const lines = await readTextPreview(blob(text), TEXT_PREVIEW_LINES);
    expect(lines).toHaveLength(4);
    expect(lines[3]?.startsWith("d")).toBe(true);
  });

  // A dialog whose job is to say something about a file must not be the thing
  // that breaks when the file is unreadable (a revoked file handle, a device
  // that went away mid-pick).
  it("answers [] rather than throwing when the blob cannot be read", async () => {
    const broken = {
      size: 10,
      slice: () => ({
        size: 10,
        text: () => Promise.reject(new Error("NotReadableError")),
      }),
    } as unknown as Blob;
    expect(await readTextPreview(broken, TEXT_PREVIEW_LINES)).toEqual([]);
  });
});
