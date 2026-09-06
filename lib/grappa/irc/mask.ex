defmodule Grappa.IRC.Mask do
  @moduledoc """
  `nick!user@host` glob masks (#162) — the shape every IRC client uses for
  `/ignore`, and the one thing grappa had no matcher for (ban masks travel as
  opaque strings).

  ## Grammar

  A mask is `nick!user@host` where each of the three parts is a glob: `*`
  matches any run of characters (including none) and `?` matches exactly one.
  A bare token with no `!` or `@` is a NICK mask and normalises to `nick!*@*`
  — so `/ignore spambot` means "that nick from anywhere", which is what an
  operator typing it expects.

  ## Folding

  The nick part folds through `Identifier.canonical_target/1` on both sides,
  because a mask is a KEY-shaped comparison (the same reason every other nick
  compare folds). User and host fold ASCII-lowercase too: idents and hostnames
  are case-insensitive on the wire, and `*!*@Evil.Example` must catch
  `evil.example`.

  ## Why glob and not regex

  `*` and `?` are what irssi, mIRC and every ircd's ban list speak. A regex
  door would be a second matching language for the same thing, and it is the
  one an operator would have to learn rather than already know.
  """

  alias Grappa.IRC.Identifier

  @typedoc "A validated, normalised mask: always `nick!user@host`."
  @type t :: String.t()

  # RFC 2812 caps a mask at what fits on a line; anything past this is not a
  # mask an operator typed, it is garbage or an attack on the regex.
  @max_mask_bytes 200

  @doc """
  Normalises operator input into a full `nick!user@host` mask, or rejects it.

  * `"spambot"`         → `{:ok, "spambot!*@*"}`
  * `"*!*@evil.example"` → `{:ok, "*!*@evil.example"}`
  * `""`, spaces, CR/LF, too long, or `!`/`@` in the wrong order → `:error`
  """
  @spec normalize(String.t()) :: {:ok, t()} | :error
  def normalize(input) when is_binary(input) do
    trimmed = String.trim(input)

    cond do
      trimmed == "" ->
        :error

      byte_size(trimmed) > @max_mask_bytes ->
        :error

      not Identifier.safe_line_token?(trimmed) ->
        :error

      # `safe_line_token?/1` only guards CR/LF/NUL (the CRLF-injection class);
      # a mask is additionally ONE whitespace-delimited token, so an embedded
      # space or tab is not a mask — it is two things the operator did not
      # mean to join.
      Regex.match?(~r/\s/u, trimmed) ->
        :error

      not String.contains?(trimmed, ["!", "@"]) ->
        {:ok, fold_mask(trimmed <> "!*@*")}

      true ->
        # `nick!user@host` — exactly one `!` before exactly one `@`, and the
        # nick part must not be empty (an empty user/host is legal: `*!@*`
        # is odd but harmless, it simply never matches a real prefix).
        case Regex.run(~r/\A([^!@]+)!([^!@]*)@([^!@]*)\z/, trimmed) do
          [_, _, _, _] -> {:ok, fold_mask(trimmed)}
          nil -> :error
        end
    end
  end

  def normalize(_), do: :error

  @doc """
  Does `mask` match the origin `{nick, user, host}`?

  `user` and `host` may be `nil` — an ircd that cloaks or a prefix that
  carried only a nick. A `nil` part matches only a wildcard-only pattern
  (`*`), never a concrete one: an ignore on `*!*@evil.example` must not fire
  for a sender whose host we simply cannot see.
  """
  @spec matches?(t(), String.t(), String.t() | nil, String.t() | nil) :: boolean()
  def matches?(mask, nick, user, host) when is_binary(mask) and is_binary(nick) do
    case String.split(mask, ["!", "@"], parts: 3) do
      [mn, mu, mh] ->
        glob?(mn, Identifier.canonical_target(nick)) and
          glob?(mu, fold_or_nil(user)) and
          glob?(mh, fold_or_nil(host))

      _ ->
        false
    end
  end

  @doc """
  True when ANY mask in `masks` matches the origin — the per-message question
  the delivery filter asks. An empty list never matches.
  """
  @spec any_match?([t()], String.t(), String.t() | nil, String.t() | nil) :: boolean()
  def any_match?([], _, _, _), do: false

  def any_match?(masks, nick, user, host) when is_list(masks) do
    Enum.any?(masks, &matches?(&1, nick, user, host))
  end

  # ---------------------------------------------------------------------------

  # Fold every part: the nick through the identifier fold, user/host plain
  # ASCII-lowercase. Same result today (both are byte-level A–Z), but routing
  # the nick through `canonical_target/1` keeps it on the one fold the rest of
  # the codebase pins.
  defp fold_mask(mask) do
    [n, u, h] = String.split(mask, ["!", "@"], parts: 3)
    Identifier.canonical_target(n) <> "!" <> ascii_down(u) <> "@" <> ascii_down(h)
  end

  defp fold_or_nil(nil), do: nil
  defp fold_or_nil(s) when is_binary(s), do: ascii_down(s)

  defp ascii_down(s), do: for(<<c <- s>>, into: "", do: <<if(c in ?A..?Z, do: c + 32, else: c)>>)

  # Glob against a possibly-absent subject. `*` alone is the only pattern that
  # matches an absent part; see `matches?/4`.
  defp glob?("*", _), do: true
  defp glob?(_, nil), do: false
  defp glob?(pattern, subject), do: Regex.match?(glob_to_regex(pattern), subject)

  defp glob_to_regex(pattern) do
    body =
      pattern
      |> String.split(~r/[*?]/, include_captures: true, trim: true)
      |> Enum.map_join(fn
        "*" -> ".*"
        "?" -> "."
        literal -> Regex.escape(literal)
      end)

    # `^`/`$` rather than the absolute anchors: without the multiline flag they
    # bind to the string ends, and every part here is a single wire token with
    # no newline in it (the prefix parser and `safe_line_token?/1` see to
    # that), so `$`'s trailing-newline tolerance can never matter. Chosen over
    # the absolute anchors because those need a backslash in a string literal,
    # and a lost backslash there reads as a bare letter and silently matches
    # nothing — which is exactly how the first cut of this shipped.
    Regex.compile!("^" <> body <> "$")
  end
end
