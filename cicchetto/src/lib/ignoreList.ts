// #162 — cic-side single source of truth for the per-network ignore list.
//
// Same shape as `highlightList.ts`, for the same reason: the list is server
// `user_settings` with NO broadcast, and every REST mutation answers the
// authoritative post-mutation list (`{masks, mask, outcome}`). Mirroring that
// answer here means the `/ignore` verbs and the ignore-list settings
// sub-page read ONE state that cannot drift — the sub-page refreshes on
// open, and an `/ignore` typed in the compose box updates the list an open
// sub-page is showing.
//
// Keyed by network SLUG, which is how the REST surface and the server-side
// `user_settings.data.ignores` map address it.
//
// cic NEVER originates state here: the signal only ever holds what the last
// server round-trip returned. Identity-scoped, so a logout / account switch
// clears the previous account's masks instead of rendering them for the next
// one until a refresh.

import { createSignal } from "solid-js";
import {
  deleteIgnore,
  getIgnores,
  type IgnoreAddResponse,
  type IgnoreRemoveResponse,
  postIgnore,
} from "./api";
import { identityScopedStore } from "./identityScopedStore";

const exports_ = identityScopedStore((onIdentityChange) => {
  const [ignoresBySlug, setIgnoresBySlug] = createSignal<Record<string, string[]>>({});

  onIdentityChange(() => setIgnoresBySlug({}));

  const mirror = (slug: string, masks: string[]): void => {
    setIgnoresBySlug((prev) => ({ ...prev, [slug]: masks }));
  };

  // Fetch one network's list (sub-page open, bare `/ignore`). Mirror + return.
  const refreshIgnores = async (token: string, slug: string): Promise<string[]> => {
    const masks = await getIgnores(token, slug);
    mirror(slug, masks);
    return masks;
  };

  // Add a mask; mirror the list and return the whole answer — the verb
  // prints the outcome on the NORMALISED mask, not the list.
  const addIgnore = async (
    token: string,
    slug: string,
    mask: string,
  ): Promise<IgnoreAddResponse> => {
    const r = await postIgnore(token, slug, mask);
    mirror(slug, r.masks);
    return r;
  };

  const delIgnore = async (
    token: string,
    slug: string,
    mask: string,
  ): Promise<IgnoreRemoveResponse> => {
    const r = await deleteIgnore(token, slug, mask);
    mirror(slug, r.masks);
    return r;
  };

  return { ignoresBySlug, refreshIgnores, addIgnore, delIgnore };
});

export const ignoresBySlug = exports_.ignoresBySlug;
export const refreshIgnores = exports_.refreshIgnores;
export const addIgnore = exports_.addIgnore;
export const delIgnore = exports_.delIgnore;
