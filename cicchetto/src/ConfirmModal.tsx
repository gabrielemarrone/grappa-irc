import {
  type Component,
  createEffect,
  createResource,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import { readTextPreview, TEXT_PREVIEW_LINES } from "./lib/attachmentPreview";
import {
  acceptConfirm,
  type ConfirmAttachment,
  type ConfirmRequest,
  chooseAlternative,
  confirmRequest,
  dismissConfirm,
} from "./lib/confirmDialog";
import { createOverlayLock } from "./lib/overlayScrollLock";

// #195 — explicit confirm modal for destructive window actions (leave
// channel, disconnect network). Store-driven singleton (lib/confirmDialog);
// mounted once per Shell layout branch (mobile + desktop). Replaces the
// removed #172 hold-to-close gesture.
//
// Backdrop-click and Esc always dismiss without firing; only the explicit
// affirmative button runs the carried action. Structure mirrors
// DeleteAccountModal (backdrop-nested dialog + overlay scroll-lock), the
// closest existing confirm-shaped modal.
//
// #1964 — which button takes INITIAL FOCUS, and therefore what a bare Enter
// answers, is now the request's own call (`ConfirmRequest.defaultButton`).
// #195's "Cancel is the SAFE default" still describes nine of the ten call
// sites and the reasoning for it has not changed; the upload confirm is the
// exception, and the argument for it lives beside that field rather than being
// re-stated here.
//
// 1883 — an OPTIONAL attachment list sits between the body and the buttons,
// for requests whose question is about FILES. It is the same chrome, not a
// second modal: the file-upload confirm gets the same scrim and the same Esc
// as every other confirm in cic, and cic gains no new overlay to keep
// consistent. The rows arrive pre-formatted (see ConfirmAttachment) — this
// component decides layout, object-URL lifetime and how each preview kind is
// rendered, nothing else.

// One attachment row. Its OWN component so the object URL can be minted and
// revoked by the row's lifecycle: `onCleanup` here fires when the row leaves —
// whether that is a per-file removal, a Send, or a dismiss — which is the only
// place that knows the URL is finished with. Doing it in the store would need
// a dismiss hook the store deliberately does not have; doing it in the caller
// would leak on every path it forgot.
//
// #1964 — the preview is per KIND, not image-or-nothing. The four arms are the
// media viewer's four arms (MediaViewerModal's `<Switch>`), pointed at a
// `blob:` URL of a file that has not been uploaded yet:
//
//   image  an `<img>`, unchanged from #1883.
//   video  a `<video preload="metadata">`, no controls: at 2.5rem a control bar
//          is unusable, and the first frame is the thing being recognised. The
//          `#t=0.1` fragment asks for a frame rather than a black poster on
//          engines that would otherwise decode nothing until play.
//   audio  an `<audio controls>` on its own line, because for sound there is no
//          picture to recognise — listening IS the preview, and it is the same
//          element the viewer gives a clicked audio link.
//   text   the first lines, read from the File. This is the one arm that cannot
//          reuse the viewer's: `TextPane` fetches through `textResource.ts`
//          with a `Range` header, and a blob: URL does not honour Range.
//
// A file with no renderer (PDF, spreadsheets) keeps the neutral placeholder.
const AttachmentRow: Component<{
  item: ConfirmAttachment;
  onRemove: (id: string) => void;
}> = (props) => {
  // Read once, not reactively: `<For>` hands each row a stable item object, so
  // a row's preview never changes under it — a re-mint would only churn URLs.
  const preview = props.item.preview;
  const kind = preview?.kind ?? null;
  // No URL for a text row: it renders a `<pre>` of lines read from the Blob, so
  // a URL there would pin the Blob for the dialog's life and be handed to
  // nothing.
  const src =
    preview === null || preview.kind === "text" ? null : URL.createObjectURL(preview.blob);
  if (src !== null) onCleanup(() => URL.revokeObjectURL(src));

  // Async, hence a resource: the dialog paints at once and the lines land when
  // the disk answers. A read that fails resolves to `[]` (see
  // `readTextPreview`), so the row degrades to its placeholder instead of
  // taking the modal down with it.
  const [lines] = createResource(
    () => (preview !== null && preview.kind === "text" ? preview.blob : undefined),
    (blob) => readTextPreview(blob, TEXT_PREVIEW_LINES),
  );
  const sourceText = (): string => (lines() ?? []).join("\n");

  return (
    <li class="confirm-modal-attachment" data-testid="confirm-modal-attachment">
      {/* The row's first line is the #1883 shape exactly: media box, name and
          size, remove button. Anything taller than the box (sound, text) goes
          UNDER it, so a mixed batch still reads as a column of like rows. */}
      <div class="confirm-modal-attachment-head">
        <Switch
          fallback={
            <span class="confirm-modal-attachment-icon" aria-hidden="true">
              {/* Nothing renderable — a neutral placeholder keeps the rows the
                  same height so a mixed batch does not read as ragged. */}
              &#9744;
            </span>
          }
        >
          <Match when={src !== null && kind === "image"}>
            <img
              class="confirm-modal-attachment-thumb"
              data-testid="confirm-modal-attachment-thumb"
              src={src ?? ""}
              // The filename beside it is the accessible label; announcing the
              // picture too would read the same file twice.
              alt=""
            />
          </Match>
          <Match when={src !== null && kind === "video"}>
            {/* No caption track and no `controls`: a still frame standing in
                for a picture, with nothing to operate and nothing to caption.
                `aria-hidden` rather than the image's `alt=""` because an empty
                alt REMOVES an `<img>` from the a11y tree while an unnamed
                `<video>` stays in it and is announced ahead of the filename
                that labels it. */}
            {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: without `controls` a <video> is not in the tab order, so hiding it traps no focus */}
            <video
              class="confirm-modal-attachment-thumb"
              data-testid="confirm-modal-attachment-video"
              src={`${src ?? ""}#t=0.1`}
              preload="metadata"
              muted
              playsinline
              aria-hidden="true"
            />
          </Match>
        </Switch>
        <span class="confirm-modal-attachment-text">
          <span class="confirm-modal-attachment-name">{props.item.label}</span>
          <span class="confirm-modal-attachment-detail">{props.item.detail}</span>
        </span>
        <button
          type="button"
          class="confirm-modal-attachment-remove"
          // Named per file: three bare × buttons are indistinguishable to a
          // screen reader, and picking the wrong one is the very mistake this
          // dialog exists to catch.
          aria-label={`Remove ${props.item.label}`}
          onClick={() => props.onRemove(props.item.id)}
        >
          &times;
        </button>
      </div>
      <Show when={src !== null && kind === "audio"}>
        {/* biome-ignore lint/a11y/useMediaCaption: a staged local upload — no caption track exists or can be authored for it */}
        <audio
          class="confirm-modal-attachment-audio"
          data-testid="confirm-modal-attachment-audio"
          src={src ?? ""}
          controls
          preload="metadata"
          // An <audio> has no accessible name of its own, and "audio" beside a
          // filename the operator cannot hear is not one.
          aria-label={`Play ${props.item.label}`}
        />
      </Show>
      <Show when={sourceText() !== ""}>
        <pre class="confirm-modal-attachment-source" data-testid="confirm-modal-attachment-source">
          {sourceText()}
        </pre>
      </Show>
    </li>
  );
};

const ConfirmModal: Component = () => {
  let cancelBtn: HTMLButtonElement | undefined;
  let confirmBtn: HTMLButtonElement | undefined;

  // Overlay scroll-lock + #232 shared Esc-to-close. dismissConfirm is the
  // same SAFE close verb Cancel / backdrop use — Esc never fires the carried
  // action (topmost-first, focus-independent).
  createOverlayLock(() => confirmRequest() !== null, ".confirm-modal", dismissConfirm);

  // Autofocus the request's own default button, which is what a bare Enter
  // answers. #195 focused Cancel unconditionally ("a stray Enter dismisses,
  // never confirms"); #1964 made it per-request, because the upload confirm's
  // Cancel is the answer that loses work — see `ConfirmRequest.defaultButton`.
  //
  // Keyed on the REQUEST OBJECT, not on an open/closed edge. The `<Show>` is
  // unkeyed, so a request replaced by another one never unmounts the dialog:
  // an open-edge guard would leave focus wherever the previous question left
  // it, and that is exactly the paste path (the guard's "Upload as .txt" door
  // clears the store and opens the send confirm in the same tick, so the
  // intermediate null is never observed). Identity still gives #195's other
  // half for free — a re-render with the SAME request does not re-steal focus.
  const focusDefault = (req: ConfirmRequest): void => {
    const target = req.defaultButton === "confirm" ? confirmBtn : cancelBtn;
    queueMicrotask(() => target?.focus());
  };

  let focusedRequest: ConfirmRequest | null = null;
  createEffect(() => {
    const req = confirmRequest();
    if (req === null) {
      focusedRequest = null;
      return;
    }
    if (req === focusedRequest) return;
    focusedRequest = req;
    focusDefault(req);
  });

  return (
    <Show when={confirmRequest()}>
      {(req) => (
        // Modal nested INSIDE the backdrop (flex-centered child): a click on
        // the modal lands on the modal, a click on the scrim dismisses.
        // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop close-on-outside; Esc via the shared overlay stack (keybindings → runTopmostOverlayEscape)
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop is a non-interactive scrim
        <div
          class="modal-backdrop modal-backdrop-full confirm-modal-backdrop"
          onClick={dismissConfirm}
          data-testid="confirm-modal-backdrop"
        >
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: inner dialog onClick only stops backdrop-click propagation; Esc closes via the shared overlay stack */}
          <div
            class="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-label={req().title}
            data-testid="confirm-modal"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 class="confirm-modal-title">{req().title}</h2>
            <p class="confirm-modal-body" data-testid="confirm-modal-body">
              {req().body}
            </p>
            {/* 1883 — the file list, when the request carries one. Between
                the question and the buttons: the operator reads what is
                about to happen, sees WHAT it happens to, then answers. */}
            <Show when={req().attachments}>
              {(atts) => (
                <ul class="confirm-modal-attachments" data-testid="confirm-modal-attachments">
                  <For each={atts().items()}>
                    {(item) => (
                      <AttachmentRow
                        item={item}
                        onRemove={(id) => {
                          atts().onRemove(id);
                          // #1964 — the × the operator just pressed unmounts
                          // with its row, and focus falls to <body>: the next
                          // Enter then answers NOTHING, in the one dialog
                          // where Enter is supposed to send. Measured in the
                          // browser, not reasoned. Hand focus back to whatever
                          // this request calls its default, which is the same
                          // button the keyboard had before the removal.
                          const current = confirmRequest();
                          if (current !== null) focusDefault(current);
                        }}
                      />
                    )}
                  </For>
                </ul>
              )}
            </Show>
            <div class="confirm-modal-actions">
              <button
                ref={cancelBtn}
                type="button"
                class="confirm-modal-cancel"
                data-testid="confirm-modal-cancel"
                onClick={dismissConfirm}
              >
                Cancel
              </button>
              {/* #816 — the optional third door, between Cancel and the
                  affirmative: a DIFFERENT route to what the operator wanted,
                  not a softer yes. Placed here so the affirmative keeps the
                  last (default-reading) slot and Cancel keeps the first. */}
              <Show when={req().alternative}>
                {(alt) => (
                  <button
                    type="button"
                    class="confirm-modal-alternative"
                    data-testid="confirm-modal-alternative"
                    onClick={chooseAlternative}
                  >
                    {alt().label}
                  </button>
                )}
              </Show>
              <button
                ref={confirmBtn}
                type="button"
                class="confirm-modal-confirm"
                data-testid="confirm-modal-confirm"
                onClick={acceptConfirm}
              >
                {req().confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
};

export default ConfirmModal;
