defmodule GrappaWeb.IgnoresControllerTest do
  @moduledoc """
  `/networks/:network_id/ignores` (#162). The list is the reply on every
  verb, the iso boundary is the shared `:resolve_network` 404, and the two
  refusal tokens the fallback renders are pinned by shape.
  """
  use GrappaWeb.ConnCase, async: true

  import Grappa.AuthFixtures

  alias Grappa.UserSettings

  setup %{conn: conn} do
    {user, session} = user_and_session()
    network = network_fixture(slug: "azzurra")
    _ = credential_fixture(user, network)
    {:ok, conn: put_bearer(conn, session.id), user: user, network: network}
  end

  describe "GET /networks/:network_id/ignores" do
    test "401 without bearer", %{network: network} do
      conn = get(build_conn(), "/networks/#{network.slug}/ignores")
      assert json_response(conn, 401) == %{"error" => "unauthorized"}
    end

    test "empty list when nothing is ignored", %{conn: conn, network: network} do
      assert json_response(get(conn, "/networks/#{network.slug}/ignores"), 200) == %{"masks" => []}
    end

    test "reflects the stored list", %{conn: conn, user: user, network: network} do
      {:ok, _, _, _} = UserSettings.add_ignore({:user, user.id}, network.slug, "spambot")

      assert json_response(get(conn, "/networks/#{network.slug}/ignores"), 200) ==
               %{"masks" => ["spambot!*@*"]}
    end
  end

  describe "POST /networks/:network_id/ignores" do
    test "201 with the resulting list; a bare nick normalises", %{conn: conn, network: network} do
      conn = post(conn, "/networks/#{network.slug}/ignores", %{"mask" => "SpamBot"})

      assert json_response(conn, 201) ==
               %{"masks" => ["spambot!*@*"], "mask" => "spambot!*@*", "outcome" => "added"}
    end

    test "an idempotent re-add answers the same list", %{conn: conn, network: network} do
      _ = post(conn, "/networks/#{network.slug}/ignores", %{"mask" => "spambot"})
      conn = post(conn, "/networks/#{network.slug}/ignores", %{"mask" => "spambot!*@*"})

      assert json_response(conn, 201) ==
               %{"masks" => ["spambot!*@*"], "mask" => "spambot!*@*", "outcome" => "already_ignored"}
    end

    test "422 invalid_mask on an unparseable mask", %{conn: conn, network: network} do
      conn = post(conn, "/networks/#{network.slug}/ignores", %{"mask" => "nick@host!user"})
      assert json_response(conn, 422) == %{"error" => "invalid_mask"}
    end

    test "400 on a missing or empty mask", %{conn: conn, network: network} do
      assert json_response(post(conn, "/networks/#{network.slug}/ignores", %{}), 400) ==
               %{"error" => "bad_request"}

      assert json_response(post(conn, "/networks/#{network.slug}/ignores", %{"mask" => ""}), 400) ==
               %{"error" => "bad_request"}
    end
  end

  describe "DELETE /networks/:network_id/ignores/:mask" do
    test "removes by normalised mask and answers the resulting list",
         %{conn: conn, user: user, network: network} do
      {:ok, _, _, _} = UserSettings.add_ignore({:user, user.id}, network.slug, "spambot")
      {:ok, _, _, _} = UserSettings.add_ignore({:user, user.id}, network.slug, "*!*@evil.example")

      conn = delete(conn, "/networks/#{network.slug}/ignores/SPAMBOT")

      assert json_response(conn, 200) ==
               %{"masks" => ["*!*@evil.example"], "mask" => "spambot!*@*", "outcome" => "removed"}
    end

    test "is idempotent — an absent mask still answers the list", %{conn: conn, network: network} do
      conn = delete(conn, "/networks/#{network.slug}/ignores/nobody")

      assert json_response(conn, 200) ==
               %{"masks" => [], "mask" => "nobody!*@*", "outcome" => "not_ignored"}
    end
  end
end
