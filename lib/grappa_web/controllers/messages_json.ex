defmodule GrappaWeb.MessagesJSON do
  @moduledoc """
  Phoenix view layer for `Grappa.Scrollback.Message` rows.

  Thin web-layer adapter: `index/1` and `show/1` follow Phoenix's
  render-function naming convention and delegate to
  `Grappa.Scrollback.Wire.to_json/1` — the single source of truth for
  the public JSON wire shape.

  Per CLAUDE.md "no leaky abstractions: each context owns its
  domain. Return domain types" — wire shape is a domain concern (the
  same shape ships over REST, PubSub broadcasts, Phoenix Channel
  pushes, and the eventual Phase 6 IRCv3 `CHATHISTORY` listener
  facade). It lives in `Grappa.Scrollback.Wire`, not here.
  """

  alias Grappa.Scrollback.{Message, Wire}

  @doc "Renders the `:index` action — a flat JSON array of message maps."
  @spec index(%{messages: [Message.t()]}) :: [Wire.t()]
  def index(%{messages: messages}), do: Enum.map(messages, &Wire.to_json/1)

  @doc """
  Renders the `:show` action — a single serialized message map.

  Takes the network slug explicitly (#1657b). `:show` renders a row that
  was JUST persisted, and the persist boundary no longer preloads
  `:network` — so this is `to_json/2`, while `index/1` above stays on
  `to_json/1` because its rows come out of a query that preloaded.
  """
  @spec show(%{message: Message.t(), network_slug: String.t()}) :: Wire.t()
  def show(%{message: message, network_slug: slug}), do: Wire.to_json(message, slug)

  @doc """
  Renders the `:count` action (#693) — the uncapped row count after an
  anchor. An object rather than a bare integer so the shape stays
  additive: a future sibling figure (say, a tail id) is a new key, not a
  breaking change of the response type. #2037 is that future arriving.

  ## Three numbers, because the route answers TWO questions (#2037)

  `count` is the THRESHOLD's feed and is unchanged from #693: raw rows a
  `?after=` page would return, own-authored included. cic's
  `isFarBehind(gap)` asks "is contiguous paging achievable", which is a
  question about rows on the wire, and the #2037 ruling puts it out of
  scope explicitly.

  `messages` + `events` are the DISPLAY split — the same
  `@content_kinds`-vs-rest partition `ReadCursor.bulk_unread_split/3`
  seeds the sidebar pills with. The far-behind bar renders `messages`,
  so the bar and the bold pill are the same quantity rather than two
  opinions about one.

  All three come from ONE `resolve_hide_presence/3` in the caller, so
  the split can never be resolved on a different presence posture than
  the count — which is precisely the divergence #2037 measured between
  the two `PresenceFilter.Resolver` doors.
  """
  @spec count(%{count: non_neg_integer(), split: Grappa.Scrollback.count_split()}) :: %{
          count: non_neg_integer(),
          messages: non_neg_integer(),
          events: non_neg_integer()
        }
  def count(%{count: n, split: %{messages: messages, events: events}}),
    do: %{count: n, messages: messages, events: events}
end
