import { type Component, createSignal, For, onMount, Show } from "solid-js";
import type { Network } from "./lib/api";
import { token } from "./lib/auth";
import { friendlyError } from "./lib/friendlyError";
import { addIgnore, delIgnore, ignoresBySlug, refreshIgnores } from "./lib/ignoreList";
import { networks } from "./lib/networks";

// #162 — the ignore-list settings SUB-PAGE. One block per network (the list
// is per network, like presence notify): the masks with a × to remove, and
// an add-input scoped to that network. Same authoritative state the
// `/ignore` verbs use (`ignoreList.ts` mirrors every REST answer) — cic never
// originates state; a × here hits the same DELETE the `/unignore` verb does.
//
// Shaped after `WatchlistsSettings` (#356) on purpose, down to the list
// classes: an operator who has pruned a watch list should not have to learn
// a second look for pruning an ignore list.

const IgnoreNetworkBlock: Component<{ net: Network }> = (props) => {
  const [draft, setDraft] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const masks = () => ignoresBySlug()[props.net.slug] ?? [];

  // No broadcast for this list — fetch on open so the block shows the
  // server's current masks, not a stale mirror from an earlier session.
  onMount(() => {
    const t = token();
    if (!t) return;
    void refreshIgnores(t, props.net.slug).catch((err) => setError(friendlyError(err)));
  });

  const onAdd = async (e: Event) => {
    e.preventDefault();
    const t = token();
    const mask = draft().trim();
    if (!t || mask === "" || busy()) return;
    setError(null);
    setBusy(true);
    try {
      await addIgnore(t, props.net.slug, mask);
      setDraft("");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (mask: string) => {
    const t = token();
    if (!t) return;
    setError(null);
    try {
      await delIgnore(t, props.net.slug, mask);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  return (
    <div class="watchlists-network" data-testid={`ignores-network-${props.net.slug}`}>
      <h5 class="watchlists-network-slug">{props.net.slug}</h5>
      <Show
        when={masks().length > 0}
        fallback={<p class="watchlists-empty">nothing ignored on {props.net.slug}.</p>}
      >
        <ul class="watchlists-list" data-testid={`ignores-list-${props.net.slug}`}>
          <For each={masks()}>
            {(mask) => (
              <li class="watchlists-item">
                <span class="watchlists-keyword">{mask}</span>
                <button
                  type="button"
                  class="watchlists-remove"
                  aria-label={`Stop ignoring ${mask} on ${props.net.slug}`}
                  onClick={() => void onRemove(mask)}
                >
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <form class="watchlists-add" onSubmit={(e) => void onAdd(e)}>
        <input
          type="text"
          autocapitalize="none"
          autocorrect="off"
          spellcheck={false}
          placeholder="add a nick or nick!user@host"
          value={draft()}
          data-testid={`ignores-add-${props.net.slug}`}
          onInput={(e) => setDraft(e.currentTarget.value)}
        />
        <button type="submit" class="watchlists-add-btn" disabled={busy()}>
          add
        </button>
      </form>
      <Show when={error()}>{(msg) => <p class="watchlists-error">{msg()}</p>}</Show>
    </div>
  );
};

const IgnoresSettings: Component<{ onBack: () => void }> = (props) => {
  return (
    <section class="settings-subpage ignores-subpage" data-testid="ignores-subpage">
      <header class="settings-subpage-header">
        <button
          type="button"
          class="settings-back"
          data-testid="ignores-back"
          aria-label="back to settings"
          onClick={props.onBack}
        >
          ‹ back
        </button>
        <h3>ignore list</h3>
      </header>

      <div class="settings-section" data-testid="ignores-section">
        <h4 class="settings-section-heading">ignored masks</h4>
        <p class="settings-section-blurb">
          messages from these are dropped before they reach you — no scrollback, no badge, no push.
          a bare nick means <code>nick!*@*</code>; <code>*</code> and <code>?</code> are wildcards.
          per network, same list as <code>/ignore</code>.
        </p>
        <Show
          when={(networks() ?? []).length > 0}
          fallback={<p class="watchlists-empty">no networks yet.</p>}
        >
          <For each={networks() ?? []}>{(net) => <IgnoreNetworkBlock net={net} />}</For>
        </Show>
      </div>
    </section>
  );
};

export default IgnoresSettings;
