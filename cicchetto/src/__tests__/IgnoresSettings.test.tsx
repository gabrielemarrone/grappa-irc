import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #162 — the ignore-list settings sub-page. Self-contained: reads the
// ignoreList store and calls its verbs on mutation. Mock those boundaries;
// assert the VISIBLE outcome (the masks render per network, × removes
// through the store, the add-form adds through the store, the list is
// refreshed on open because nothing broadcasts it).

const addIgnoreMock = vi.fn().mockResolvedValue({ masks: [], mask: "x!*@*", outcome: "added" });
const delIgnoreMock = vi
  .fn()
  .mockResolvedValue({ masks: [], mask: "spambot!*@*", outcome: "removed" });
const refreshIgnoresMock = vi.fn().mockResolvedValue([]);

let networksData: Array<{ kind: string; id: number; slug: string; nick: string }> = [];
let ignoresData: Record<string, string[]> = {};

vi.mock("../lib/auth", () => ({ token: () => "tok" }));

vi.mock("../lib/networks", () => ({
  networkIdBySlug: () => undefined,
  networks: () => networksData,
}));

vi.mock("../lib/ignoreList", () => ({
  ignoresBySlug: () => ignoresData,
  refreshIgnores: (t: string, slug: string) => refreshIgnoresMock(t, slug),
  addIgnore: (t: string, slug: string, mask: string) => addIgnoreMock(t, slug, mask),
  delIgnore: (t: string, slug: string, mask: string) => delIgnoreMock(t, slug, mask),
}));

import IgnoresSettings from "../IgnoresSettings";
import { ApiError } from "../lib/api";

beforeEach(() => {
  vi.clearAllMocks();
  networksData = [
    { kind: "user", id: 1, slug: "freenode", nick: "vjt" },
    { kind: "user", id: 2, slug: "ircnet", nick: "vjt" },
  ];
  ignoresData = { freenode: ["spambot!*@*", "*!*@*.evil.example"] };
});

describe("IgnoresSettings (#162)", () => {
  it("renders the sub-page with one block per network", () => {
    render(() => <IgnoresSettings onBack={() => {}} />);
    expect(screen.getByTestId("ignores-subpage")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /ignore list/i })).toBeInTheDocument();
    expect(screen.getByTestId("ignores-network-freenode")).toBeInTheDocument();
    expect(screen.getByTestId("ignores-network-ircnet")).toBeInTheDocument();
  });

  it("‹ back fires onBack", () => {
    const onBack = vi.fn();
    render(() => <IgnoresSettings onBack={onBack} />);
    fireEvent.click(screen.getByTestId("ignores-back"));
    expect(onBack).toHaveBeenCalled();
  });

  it("refreshes every network's list on mount (no broadcast, must fetch)", () => {
    render(() => <IgnoresSettings onBack={() => {}} />);
    expect(refreshIgnoresMock).toHaveBeenCalledWith("tok", "freenode");
    expect(refreshIgnoresMock).toHaveBeenCalledWith("tok", "ircnet");
  });

  it("shows the masks of a network and × removes through the store, by network", () => {
    render(() => <IgnoresSettings onBack={() => {}} />);
    expect(screen.getByText("spambot!*@*")).toBeInTheDocument();
    expect(screen.getByText("*!*@*.evil.example")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /stop ignoring spambot!\*@\* on freenode/i }),
    );
    expect(delIgnoreMock).toHaveBeenCalledWith("tok", "freenode", "spambot!*@*");
  });

  it("the per-network add-form adds through the store, scoped to that network", () => {
    render(() => <IgnoresSettings onBack={() => {}} />);
    const input = screen.getByTestId("ignores-add-ircnet") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "troll" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(addIgnoreMock).toHaveBeenCalledWith("tok", "ircnet", "troll");
  });

  it("a network with nothing ignored says so and still offers the add-form", () => {
    render(() => <IgnoresSettings onBack={() => {}} />);
    expect(screen.getByText(/nothing ignored on ircnet/)).toBeInTheDocument();
    expect(screen.getByTestId("ignores-add-ircnet")).toBeInTheDocument();
    expect(screen.queryByTestId("ignores-list-ircnet")).not.toBeInTheDocument();
  });

  it("a rejected mask surfaces the server's reason instead of vanishing", async () => {
    // The 422 the server answers for a bad mask, so the page shows the same
    // friendly line the compose box does.
    addIgnoreMock.mockRejectedValueOnce(new ApiError(422, "invalid_mask"));
    render(() => <IgnoresSettings onBack={() => {}} />);
    const input = screen.getByTestId("ignores-add-freenode") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "a b" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(await screen.findByText(/not valid/)).toBeInTheDocument();
  });
});
