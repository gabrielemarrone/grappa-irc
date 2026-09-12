// 2094 — the operator chooses how long the upload lives, in the dialog that
// shows them what it is.
//
// The defect: the TTL ladder was reachable only from the settings drawer, so
// retention was decided once, in advance, for every future file — while the
// moment an operator actually knows what a file is worth is the moment they
// are looking at it. The server has taken a per-request `expire` since the
// embedded host landed (`UploadsController.parse_ttl/1`); nothing in the UI
// could reach it.
//
// Why a real browser and not jsdom: the unit tests prove the orchestrator
// hands the chosen seconds to the host, which is a statement about a function
// call. What has to be true is that the CHOICE reaches the SERVER, and the
// only honest witness to that is the multipart body of the real POST.

import type { Page } from "@playwright/test";
import { TINY_PNG_HEX } from "../fixtures/bytes";
import { loginAs, scrollbackLine, selectChannel } from "../fixtures/cicchettoPage";
import { setUploadConfirmEnabled } from "../fixtures/grappaApi";
import { AUTOJOIN_CHANNELS, NETWORK_SLUG } from "../fixtures/seedData";
import { expect, specNick, specUser, test } from "../fixtures/test";
import { sendPickedFiles } from "../fixtures/uploadJourney";

const CHANNEL = AUTOJOIN_CHANNELS[0];

const png = (name: string) => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.from(TINY_PNG_HEX, "hex"),
});

// Collect the multipart bodies of real POSTs to the embedded host. Same
// same-origin constraint as #1883's counter — a `page.route()` stub would
// block cic's own bootstrap — so the request is observed, never intercepted.
function collectUploadBodies(page: Page): () => string[] {
  const bodies: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().endsWith("/api/uploads")) {
      bodies.push(req.postData() ?? "");
    }
  });
  return () => bodies;
}

test("2094 — the chosen duration is the one the server is asked for", async ({ page }) => {
  const bodies = collectUploadBodies(page);

  // The choice lives in the confirm, so the operator this spec describes has
  // opted into it; the privacy notice is pre-acked because it is one-shot per
  // host and is not what this spec is about.
  await setUploadConfirmEnabled(specUser().token, true);
  await loginAs(page, specUser());
  await selectChannel(page, NETWORK_SLUG, CHANNEL, { ownNick: specNick() });
  await page.evaluate(() =>
    localStorage.setItem("image-upload-privacy-acknowledged:embedded", "1"),
  );

  await page.locator("input[data-file-picker]").setInputFiles(png("keeper.png"));

  const confirm = page.getByTestId("confirm-modal");
  await expect(confirm).toBeVisible({ timeout: 5_000 });

  // The control is named in words. A bare dropdown reading "24 hours" says
  // nothing about what happens then, which is the whole reason it carries a
  // visible label rather than only an accessible one.
  await expect(page.getByTestId("confirm-modal-choice")).toContainText("Delete after");

  const select = page.getByTestId("confirm-modal-choice-select");
  // The embedded host's ladder, which is the server's own `@allowed_ttl_seconds`
  // spelled in seconds — the currency the preference and the server share.
  await expect(select.locator("option")).toHaveText(["1 hour", "12 hours", "24 hours", "72 hours"]);
  // Seeded with what would have happened anyway: this operator set no
  // preference, so the host's own default. A choice is an override, never a
  // required answer.
  await expect(select).toHaveValue("86400");

  await select.selectOption("3600");
  await sendPickedFiles(page);

  await expect(scrollbackLine(page, "privmsg", "📸").first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => bodies().length, { timeout: 15_000 }).toBe(1);
  // The wire, not the intent: the multipart body carries the `expire` field
  // the controller parses. A UI that changed its own label and posted the
  // default anyway would be green everywhere else and red here. Read the
  // field's own segment rather than the whole body — the PNG bytes are in
  // there too, and "contains 3600 somewhere" is not evidence.
  const expireField = bodies()[0]?.split('name="expire"')[1]?.slice(0, 120) ?? "";
  expect(expireField).toContain("3600");
  expect(expireField).not.toContain("86400");
});
