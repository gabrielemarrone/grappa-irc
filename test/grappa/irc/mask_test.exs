defmodule Grappa.IRC.MaskTest do
  @moduledoc """
  `Grappa.IRC.Mask` (#162) — the `nick!user@host` glob matcher behind /ignore.
  Three properties carry the feature: a bare nick means "from anywhere", an
  origin part we cannot see never satisfies a concrete pattern, and the fold
  is the NETWORK's (#537) — `Foo[1]` and `foo{1}` are one person on rfc1459
  and two on ascii.
  """
  use ExUnit.Case, async: true

  alias Grappa.IRC.Mask

  defp m(mask), do: Mask.compile(mask)

  describe "normalize/2" do
    test "a bare nick becomes nick!*@*, folded" do
      assert Mask.normalize("SpamBot", :ascii) == {:ok, "spambot!*@*"}
    end

    test "a full mask is kept, every part folded" do
      assert Mask.normalize("*!*@Evil.Example", :ascii) == {:ok, "*!*@evil.example"}
      assert Mask.normalize("Nick!~User@Host", :ascii) == {:ok, "nick!~user@host"}
    end

    test "surrounding whitespace is trimmed" do
      assert Mask.normalize("  spambot  ", :ascii) == {:ok, "spambot!*@*"}
    end

    # The #537 ingress rule applied to one more key: the nick part folds with
    # the network's casemapping, so the stored mask already sits in that
    # network's folded space. User and host never fold national chars.
    test "the nick part folds with the network's casemapping" do
      assert Mask.normalize("Foo[1]", :rfc1459) == {:ok, "foo{1}!*@*"}
      assert Mask.normalize("Foo[1]", :ascii) == {:ok, "foo[1]!*@*"}
      assert Mask.normalize("Foo~1", :rfc1459) == {:ok, "foo^1!*@*"}
      assert Mask.normalize("Foo~1", :rfc1459_strict) == {:ok, "foo~1!*@*"}
      assert Mask.normalize("Foo[1]!~[u]@[h]", :rfc1459) == {:ok, "foo{1}!~[u]@[h]"}
    end

    test "rejects empty, embedded whitespace, and line breaks" do
      assert Mask.normalize("", :ascii) == :error
      assert Mask.normalize("   ", :ascii) == :error
      assert Mask.normalize("a b", :ascii) == :error
      assert Mask.normalize("a\r\nb", :ascii) == :error
    end

    test "rejects ! and @ in the wrong order or count" do
      assert Mask.normalize("nick@host!user", :ascii) == :error
      assert Mask.normalize("a!b!c@d", :ascii) == :error
      assert Mask.normalize("!user@host", :ascii) == :error
    end

    test "rejects a mask longer than a line could carry" do
      assert Mask.normalize(String.duplicate("a", 201), :ascii) == :error
    end

    test "rejects non-binaries" do
      assert Mask.normalize(nil, :ascii) == :error
      assert Mask.normalize(42, :ascii) == :error
    end
  end

  describe "compile/1" do
    test "a bare * part compiles to :any — no regex for the common shape" do
      assert %Mask{nick: %Regex{}, user: :any, host: :any} = Mask.compile("spambot!*@*")
      assert %Mask{nick: :any, user: :any, host: %Regex{}} = Mask.compile("*!*@evil.example")
    end

    test "a string that is not nick!user@host compiles to a mask that matches nothing" do
      compiled = Mask.compile("garbage")
      assert %Mask{nick: :never} = compiled
      refute Mask.matches?(compiled, "garbage", nil, nil, :ascii)
    end

    test "compile_all/1 keeps order and source" do
      assert Enum.map(Mask.compile_all(["a!*@*", "b!*@*"]), & &1.source) == ["a!*@*", "b!*@*"]
    end
  end

  describe "matches?/5" do
    test "a nick mask matches that nick from any user@host" do
      assert Mask.matches?(m("spambot!*@*"), "spambot", "~x", "h.example", :ascii)
      assert Mask.matches?(m("spambot!*@*"), "SpamBot", nil, nil, :ascii)
    end

    test "a nick mask does not match a different nick" do
      refute Mask.matches?(m("spambot!*@*"), "spambot2", "~x", "h.example", :ascii)
    end

    test "* spans any run, ? exactly one character" do
      assert Mask.matches?(m("spam*!*@*"), "spambot", nil, nil, :ascii)
      assert Mask.matches?(m("spa?bot!*@*"), "spambot", nil, nil, :ascii)
      refute Mask.matches?(m("spa?bot!*@*"), "spammbot", nil, nil, :ascii)
    end

    test "a host mask matches any nick from that host, case-insensitively" do
      assert Mask.matches?(m("*!*@evil.example"), "alice", "~a", "Evil.Example", :ascii)
      refute Mask.matches?(m("*!*@evil.example"), "alice", "~a", "good.example", :ascii)
    end

    # The rule that keeps a cloaked ircd from turning a targeted ignore into
    # a blanket one: an absent part satisfies only `*`, never a real pattern.
    test "a concrete user/host pattern never matches an absent part" do
      refute Mask.matches?(m("*!*@evil.example"), "alice", nil, nil, :ascii)
      refute Mask.matches?(m("*!~bad@*"), "alice", nil, "h", :ascii)
      assert Mask.matches?(m("alice!*@*"), "alice", nil, nil, :ascii)
    end

    test "regex metacharacters in a mask are literal" do
      assert Mask.matches?(m("a.b!*@*"), "a.b", nil, nil, :ascii)
      refute Mask.matches?(m("a.b!*@*"), "axb", nil, nil, :ascii)
      refute Mask.matches?(m("[a]!*@*"), "a", nil, nil, :ascii)
    end

    # The subject folds with the SESSION's casemapping, the pattern was folded
    # at write time: on rfc1459 the stored `foo{1}` catches a `Foo[1]` sender;
    # on ascii the two spellings stay distinct in both directions.
    test "the subject nick folds with the session's casemapping (#537)" do
      {:ok, on_rfc} = Mask.normalize("Foo[1]", :rfc1459)
      assert Mask.matches?(m(on_rfc), "Foo[1]", nil, nil, :rfc1459)
      assert Mask.matches?(m(on_rfc), "foo{1}", nil, nil, :rfc1459)

      {:ok, on_ascii} = Mask.normalize("Foo[1]", :ascii)
      assert Mask.matches?(m(on_ascii), "FOO[1]", nil, nil, :ascii)
      refute Mask.matches?(m(on_ascii), "foo{1}", nil, nil, :ascii)
    end

    # The absolute anchors, pinned from both sides (review, #1984): `\z` must
    # refuse a subject with a trailing newline, which `$` would accept — and a
    # lost backslash would turn `\A` into a literal `A` and match NOTHING,
    # which every positive assertion in this file catches.
    test "anchors are absolute — a trailing newline is not the end of the nick" do
      refute Mask.matches?(m("alice!*@*"), "alice\n", nil, nil, :ascii)
      refute Mask.matches?(m("*!*@evil.example"), "alice", nil, "evil.example\n", :ascii)
      assert Mask.matches?(m("alice!*@*"), "alice", nil, nil, :ascii)
    end
  end

  describe "any_match?/5" do
    test "empty list never matches" do
      refute Mask.any_match?([], "anyone", "u", "h", :ascii)
    end

    test "true when any mask in the list matches" do
      masks = Mask.compile_all(["alice!*@*", "*!*@evil.example"])
      assert Mask.any_match?(masks, "bob", "~b", "evil.example", :ascii)
      assert Mask.any_match?(masks, "alice", nil, nil, :ascii)
      refute Mask.any_match?(masks, "carol", "~c", "good.example", :ascii)
    end
  end
end
