defmodule Grappa.IRC.MaskTest do
  @moduledoc """
  `Grappa.IRC.Mask` (#162) — the `nick!user@host` glob matcher behind /ignore.
  Two properties carry the feature: a bare nick means "from anywhere", and an
  origin part we cannot see never satisfies a concrete pattern.
  """
  use ExUnit.Case, async: true

  alias Grappa.IRC.Mask

  describe "normalize/1" do
    test "a bare nick becomes nick!*@*, folded" do
      assert Mask.normalize("SpamBot") == {:ok, "spambot!*@*"}
    end

    test "a full mask is kept, every part folded" do
      assert Mask.normalize("*!*@Evil.Example") == {:ok, "*!*@evil.example"}
      assert Mask.normalize("Nick!~User@Host") == {:ok, "nick!~user@host"}
    end

    test "surrounding whitespace is trimmed" do
      assert Mask.normalize("  spambot  ") == {:ok, "spambot!*@*"}
    end

    test "rejects empty, embedded whitespace, and line breaks" do
      assert Mask.normalize("") == :error
      assert Mask.normalize("   ") == :error
      assert Mask.normalize("a b") == :error
      assert Mask.normalize("a\r\nb") == :error
    end

    test "rejects ! and @ in the wrong order or count" do
      assert Mask.normalize("nick@host!user") == :error
      assert Mask.normalize("a!b!c@d") == :error
      assert Mask.normalize("!user@host") == :error
    end

    test "rejects a mask longer than a line could carry" do
      assert Mask.normalize(String.duplicate("a", 201)) == :error
    end

    test "rejects non-binaries" do
      assert Mask.normalize(nil) == :error
      assert Mask.normalize(42) == :error
    end
  end

  describe "matches?/4" do
    test "a nick mask matches that nick from any user@host" do
      assert Mask.matches?("spambot!*@*", "spambot", "~x", "h.example")
      assert Mask.matches?("spambot!*@*", "SpamBot", nil, nil)
    end

    test "a nick mask does not match a different nick" do
      refute Mask.matches?("spambot!*@*", "spambot2", "~x", "h.example")
    end

    test "* spans any run, ? exactly one character" do
      assert Mask.matches?("spam*!*@*", "spambot", nil, nil)
      assert Mask.matches?("spa?bot!*@*", "spambot", nil, nil)
      refute Mask.matches?("spa?bot!*@*", "spammbot", nil, nil)
    end

    test "a host mask matches any nick from that host, case-insensitively" do
      assert Mask.matches?("*!*@evil.example", "alice", "~a", "Evil.Example")
      refute Mask.matches?("*!*@evil.example", "alice", "~a", "good.example")
    end

    # The rule that keeps a cloaked ircd from turning a targeted ignore into
    # a blanket one: an absent part satisfies only `*`, never a real pattern.
    test "a concrete user/host pattern never matches an absent part" do
      refute Mask.matches?("*!*@evil.example", "alice", nil, nil)
      refute Mask.matches?("*!~bad@*", "alice", nil, "h")
      assert Mask.matches?("alice!*@*", "alice", nil, nil)
    end

    test "regex metacharacters in a mask are literal" do
      assert Mask.matches?("a.b!*@*", "a.b", nil, nil)
      refute Mask.matches?("a.b!*@*", "axb", nil, nil)
      refute Mask.matches?("[a]!*@*", "a", nil, nil)
    end

    test "a malformed mask matches nothing rather than raising" do
      refute Mask.matches?("garbage", "garbage", nil, nil)
    end
  end

  describe "any_match?/4" do
    test "empty list never matches" do
      refute Mask.any_match?([], "anyone", "u", "h")
    end

    test "true when any mask in the list matches" do
      masks = ["alice!*@*", "*!*@evil.example"]
      assert Mask.any_match?(masks, "bob", "~b", "evil.example")
      assert Mask.any_match?(masks, "alice", nil, nil)
      refute Mask.any_match?(masks, "carol", "~c", "good.example")
    end
  end
end
