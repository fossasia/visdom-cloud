# Copyright 2017-present, The Visdom Authors
WORKSPACES = "/api/v1/workspaces"


def test_direct_invite_and_accept_flow(client, make_user, make_workspace):
    owner = make_user()
    invitee = make_user()
    workspace = make_workspace(owner)

    invited = client.post(
        f"{WORKSPACES}/{workspace['id']}/members",
        json={"email": invitee["email"].upper(), "role": "member"},
        headers=owner["headers"],
    )
    assert invited.status_code == 201
    assert invited.json()["user_id"] == invitee["id"]
    assert invited.json()["status"] == "pending_acceptance"

    assert client.get(WORKSPACES, headers=invitee["headers"]).json() == []

    pending = client.get(f"{WORKSPACES}/invites/pending", headers=invitee["headers"])
    assert pending.status_code == 200
    assert len(pending.json()) == 1
    assert pending.json()[0]["workspace"]["id"] == workspace["id"]
    assert pending.json()[0]["role"] == "member"

    accepted = client.post(
        f"{WORKSPACES}/{workspace['id']}/members/me/accept", headers=invitee["headers"]
    )
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "active"

    workspaces = client.get(WORKSPACES, headers=invitee["headers"]).json()
    assert [ws["id"] for ws in workspaces] == [workspace["id"]]
    assert workspaces[0]["role"] == "member"
    assert client.get(f"{WORKSPACES}/invites/pending", headers=invitee["headers"]).json() == []

    re_accept = client.post(
        f"{WORKSPACES}/{workspace['id']}/members/me/accept", headers=invitee["headers"]
    )
    assert re_accept.status_code == 400


def test_invite_requires_admin(client, make_user, make_workspace, add_member):
    owner = make_user()
    member = make_user()
    outsider = make_user()
    someone = make_user()
    workspace = make_workspace(owner)
    add_member(owner, workspace, member)

    as_member = client.post(
        f"{WORKSPACES}/{workspace['id']}/members",
        json={"email": someone["email"], "role": "member"},
        headers=member["headers"],
    )
    assert as_member.status_code == 403

    as_outsider = client.post(
        f"{WORKSPACES}/{workspace['id']}/members",
        json={"email": someone["email"], "role": "member"},
        headers=outsider["headers"],
    )
    assert as_outsider.status_code == 404


def test_invite_duplicate_member(client, make_user, make_workspace, add_member):
    owner = make_user()
    member = make_user()
    workspace = make_workspace(owner)
    add_member(owner, workspace, member)

    duplicate = client.post(
        f"{WORKSPACES}/{workspace['id']}/members",
        json={"email": member["email"], "role": "viewer"},
        headers=owner["headers"],
    )
    assert duplicate.status_code == 400


def test_invitee_can_decline_invite(client, make_user, make_workspace):
    owner = make_user()
    invitee = make_user()
    workspace = make_workspace(owner)

    client.post(
        f"{WORKSPACES}/{workspace['id']}/members",
        json={"email": invitee["email"], "role": "member"},
        headers=owner["headers"],
    )

    declined = client.delete(
        f"{WORKSPACES}/{workspace['id']}/members/{invitee['id']}", headers=invitee["headers"]
    )
    assert declined.status_code == 204
    assert client.get(f"{WORKSPACES}/invites/pending", headers=invitee["headers"]).json() == []

    members = client.get(f"{WORKSPACES}/{workspace['id']}/members", headers=owner["headers"]).json()
    assert [m["user_id"] for m in members] == [owner["id"]]

    re_invited = client.post(
        f"{WORKSPACES}/{workspace['id']}/members",
        json={"email": invitee["email"], "role": "member"},
        headers=owner["headers"],
    )
    assert re_invited.status_code == 201


def test_approve_endpoint_rejects_direct_invites(client, make_user, make_workspace):
    owner = make_user()
    invitee = make_user()
    workspace = make_workspace(owner)

    client.post(
        f"{WORKSPACES}/{workspace['id']}/members",
        json={"email": invitee["email"], "role": "member"},
        headers=owner["headers"],
    )

    approved = client.post(
        f"{WORKSPACES}/{workspace['id']}/members/{invitee['id']}/approve",
        headers=owner["headers"],
    )
    assert approved.status_code == 400


def test_role_update_rules(client, make_user, make_workspace, add_member):
    owner = make_user()
    member = make_user()
    second_admin = make_user()
    workspace = make_workspace(owner)
    add_member(owner, workspace, member)
    add_member(owner, workspace, second_admin, role="admin")

    promoted = client.put(
        f"{WORKSPACES}/{workspace['id']}/members/{member['id']}",
        json={"role": "viewer"},
        headers=owner["headers"],
    )
    assert promoted.status_code == 200
    assert promoted.json()["role"] == "viewer"

    own_role = client.put(
        f"{WORKSPACES}/{workspace['id']}/members/{owner['id']}",
        json={"role": "member"},
        headers=owner["headers"],
    )
    assert own_role.status_code == 403
    assert own_role.json()["detail"] == "You cannot change your own role."

    as_member = client.put(
        f"{WORKSPACES}/{workspace['id']}/members/{owner['id']}",
        json={"role": "member"},
        headers=member["headers"],
    )
    assert as_member.status_code == 403

    owner_role = client.put(
        f"{WORKSPACES}/{workspace['id']}/members/{owner['id']}",
        json={"role": "member"},
        headers=second_admin["headers"],
    )
    assert owner_role.status_code == 403
    assert owner_role.json()["detail"] == "The workspace owner's role cannot be changed."

    invalid = client.put(
        f"{WORKSPACES}/{workspace['id']}/members/{member['id']}",
        json={"role": "superuser"},
        headers=owner["headers"],
    )
    assert invalid.status_code == 422


def test_role_update_requires_active_membership(client, make_user, make_workspace):
    owner = make_user()
    invitee = make_user()
    workspace = make_workspace(owner)

    client.post(
        f"{WORKSPACES}/{workspace['id']}/members",
        json={"email": invitee["email"], "role": "member"},
        headers=owner["headers"],
    )

    changed = client.put(
        f"{WORKSPACES}/{workspace['id']}/members/{invitee['id']}",
        json={"role": "admin"},
        headers=owner["headers"],
    )
    assert changed.status_code == 400


def test_remove_member_rules(client, make_user, make_workspace, add_member):
    owner = make_user()
    member = make_user()
    second_admin = make_user()
    workspace = make_workspace(owner)
    add_member(owner, workspace, member)
    add_member(owner, workspace, second_admin, role="admin")

    as_member = client.delete(
        f"{WORKSPACES}/{workspace['id']}/members/{second_admin['id']}", headers=member["headers"]
    )
    assert as_member.status_code == 403

    owner_kick = client.delete(
        f"{WORKSPACES}/{workspace['id']}/members/{owner['id']}", headers=second_admin["headers"]
    )
    assert owner_kick.status_code == 403
    assert (
        owner_kick.json()["detail"]
        == "Only the workspace owner can remove themselves from the workspace."
    )

    removed = client.delete(
        f"{WORKSPACES}/{workspace['id']}/members/{member['id']}", headers=owner["headers"]
    )
    assert removed.status_code == 204
    assert client.get(WORKSPACES, headers=member["headers"]).json() == []

    owner_leave = client.delete(
        f"{WORKSPACES}/{workspace['id']}/members/{owner['id']}", headers=owner["headers"]
    )
    assert owner_leave.status_code == 204
    assert client.get(WORKSPACES, headers=owner["headers"]).json() == []
    assert [
        ws["id"] for ws in client.get(WORKSPACES, headers=second_admin["headers"]).json()
    ] == [workspace["id"]]


def test_cannot_remove_last_admin(client, make_user, make_workspace, add_member):
    owner = make_user()
    member = make_user()
    workspace = make_workspace(owner)
    add_member(owner, workspace, member)

    blocked = client.delete(
        f"{WORKSPACES}/{workspace['id']}/members/{owner['id']}", headers=owner["headers"]
    )
    assert blocked.status_code == 400
    assert blocked.json()["detail"] == "Cannot remove the last admin of a workspace."


def test_unregistered_email_invite_lifecycle(client, make_user, make_workspace, add_member):
    owner = make_user()
    member = make_user()
    workspace = make_workspace(owner)
    add_member(owner, workspace, member)
    ghost_email = "ghost@example.com"

    invited = client.post(
        f"{WORKSPACES}/{workspace['id']}/members",
        json={"email": ghost_email, "role": "viewer"},
        headers=owner["headers"],
    )
    assert invited.status_code == 201
    data = invited.json()
    assert data["user_id"] is None
    assert data["invite_id"] is not None
    assert data["status"] == "pending_acceptance"
    invite_id = data["invite_id"]

    re_invited = client.post(
        f"{WORKSPACES}/{workspace['id']}/members",
        json={"email": ghost_email, "role": "viewer"},
        headers=owner["headers"],
    )
    assert re_invited.status_code == 400

    as_member = client.delete(
        f"{WORKSPACES}/{workspace['id']}/invites/{invite_id}", headers=member["headers"]
    )
    assert as_member.status_code == 403

    cancelled = client.delete(
        f"{WORKSPACES}/{workspace['id']}/invites/{invite_id}", headers=owner["headers"]
    )
    assert cancelled.status_code == 204
    members = client.get(f"{WORKSPACES}/{workspace['id']}/members", headers=owner["headers"]).json()
    assert all(m["invite_id"] is None for m in members)

    client.post(
        f"{WORKSPACES}/{workspace['id']}/members",
        json={"email": ghost_email, "role": "viewer"},
        headers=owner["headers"],
    )
    ghost = make_user(email=ghost_email)

    pending = client.get(f"{WORKSPACES}/invites/pending", headers=ghost["headers"]).json()
    assert len(pending) == 1
    assert pending[0]["workspace"]["id"] == workspace["id"]
    assert pending[0]["role"] == "viewer"

    members = client.get(f"{WORKSPACES}/{workspace['id']}/members", headers=owner["headers"]).json()
    ghost_row = next(m for m in members if m["email"] == ghost_email)
    assert ghost_row["user_id"] == ghost["id"]
    assert ghost_row["invite_id"] is None

    accepted = client.post(
        f"{WORKSPACES}/{workspace['id']}/members/me/accept", headers=ghost["headers"]
    )
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "active"
    assert accepted.json()["role"] == "viewer"
