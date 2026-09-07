defmodule GrappaWeb.IgnoresController do
  @moduledoc """
  REST surface for the `/ignore` mask list (GH #162) —
  `/networks/:network_id/ignores`.

  Thin per CLAUDE.md: parse params, call `Grappa.UserSettings` (the DB-owned
  list) + `Grappa.Session.ignores_changed/3` (live sync), render. The same
  context functions back the cic `/ignore` + `/unignore` commands — one
  authoritative list, two faces.

  ## The list is the reply, every time

  `POST` and `DELETE` both answer with the resulting list rather than the one
  mask touched. A client that renders the list has nothing to reconcile, and
  an idempotent re-add (already present → 200, same list) is indistinguishable
  from a first add on the wire, which is the point of idempotence.

  ## Live sync contract

  Every mutation pushes the WHOLE resulting list to the live session
  (`Session.ignores_changed/3`), which replaces `state.ignores`. No session
  running is a normal `:ok` — the next spawn reads the list at init.

  Iso boundary: `Plugs.ResolveNetwork` collapses unknown-slug /
  not-your-network to 404 before any action runs, same as `/notify`.
  """
  use GrappaWeb, :controller

  alias Grappa.{Session, UserSettings}
  alias GrappaWeb.Subject, as: WebSubject

  @doc "`GET /networks/:network_id/ignores` — the masks for this subject on this network."
  @spec index(Plug.Conn.t(), map()) :: Plug.Conn.t()
  def index(conn, _) do
    network = conn.assigns.network
    json(conn, %{masks: UserSettings.get_ignores(session_subject(conn), network.slug)})
  end

  @doc """
  `POST /networks/:network_id/ignores` — add one mask. Body `{"mask": "..."}`;
  a bare nick normalises to `nick!*@*`. 201 with `{masks, mask, outcome}` —
  the resulting list, the normalised mask, and `added` / `already_ignored`;
  422 `invalid_mask` / `list_full` via FallbackController.
  """
  @spec create(Plug.Conn.t(), map()) ::
          Plug.Conn.t() | {:error, :bad_request | :invalid_mask | :list_full | term()}
  def create(conn, %{"mask" => mask}) when is_binary(mask) and mask != "" do
    subject = session_subject(conn)
    network = conn.assigns.network

    # #537 ingress: the mask folds with THIS network's casemapping, read off
    # the live session (`:ascii` when none — the same door `/notify` uses).
    casemapping = Session.casemapping(subject, network.id)

    with {:ok, outcome, mask, masks} <-
           UserSettings.add_ignore(subject, network.slug, mask, casemapping) do
      :ok = Session.ignores_changed(subject, network.id, masks)

      conn
      |> put_status(:created)
      |> json(%{masks: masks, mask: mask, outcome: outcome})
    end
  end

  def create(_, _), do: {:error, :bad_request}

  @doc """
  `DELETE /networks/:network_id/ignores/:mask` — remove one mask (normalised
  before comparing, idempotent). 200 with the resulting list either way.
  """
  @spec remove(Plug.Conn.t(), map()) :: Plug.Conn.t() | {:error, :invalid_mask | term()}
  def remove(conn, %{"mask" => mask}) when is_binary(mask) and mask != "" do
    subject = session_subject(conn)
    network = conn.assigns.network

    casemapping = Session.casemapping(subject, network.id)

    with {:ok, outcome, mask, masks} <-
           UserSettings.remove_ignore(subject, network.slug, mask, casemapping) do
      :ok = Session.ignores_changed(subject, network.id, masks)
      json(conn, %{masks: masks, mask: mask, outcome: outcome})
    end
  end

  defp session_subject(conn), do: WebSubject.to_session(conn.assigns.current_subject)
end
