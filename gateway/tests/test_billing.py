# Copyright 2017-present, The Visdom Authors
BILLING = "/api/v1/billing"


def test_list_plans(client):
    response = client.get(f"{BILLING}/plans")
    assert response.status_code == 200
    plans = response.json()
    assert [plan["id"] for plan in plans] == ["free", "pro", "enterprise"]

    free, pro, enterprise = plans
    assert free["price"] == 0
    assert free["limits"] == {"workspaces": 1, "members": 3, "api_keys": 2}
    assert pro["price"] == 29
    assert pro["limits"]["members"] is None
    assert enterprise["price"] is None
    assert enterprise["limits"] == {"workspaces": None, "members": None, "api_keys": None}
    assert all(plan["features"] for plan in plans)


def test_subscription_requires_auth(client):
    assert client.get(f"{BILLING}/subscription").status_code == 401
    assert client.post(f"{BILLING}/subscription", json={"tier": "pro"}).status_code == 401


def test_fresh_user_subscription(client, make_user):
    user = make_user()
    response = client.get(f"{BILLING}/subscription", headers=user["headers"])
    assert response.status_code == 200
    data = response.json()
    assert data["tier"] == "free"
    assert data["plan"]["id"] == "free"
    assert data["usage"] == {
        "workspaces": {"used": 0, "limit": 1},
        "members": {"used": 0, "limit": 3},
        "api_keys": {"used": 0, "limit": 2},
    }


def test_subscription_usage_counts(client, make_user, make_workspace, add_member):
    owner = make_user()
    member = make_user()
    pending = make_user()
    ws1 = make_workspace(owner)
    make_workspace(owner)
    add_member(owner, ws1, member)
    client.post(
        f"/api/v1/workspaces/{ws1['id']}/members",
        json={"email": pending["email"], "role": "member"},
        headers=owner["headers"],
    )
    client.post("/api/v1/keys", json={"name": "usage-key"}, headers=owner["headers"])

    usage = client.get(f"{BILLING}/subscription", headers=owner["headers"]).json()["usage"]
    assert usage["workspaces"]["used"] == 2
    assert usage["members"]["used"] == 1
    assert usage["api_keys"]["used"] == 1

    member_usage = client.get(f"{BILLING}/subscription", headers=member["headers"]).json()["usage"]
    assert member_usage["workspaces"]["used"] == 0
    assert member_usage["members"]["used"] == 0
    assert member_usage["api_keys"]["used"] == 0


def test_change_plan(client, make_user):
    user = make_user()

    upgraded = client.post(
        f"{BILLING}/subscription", json={"tier": "pro"}, headers=user["headers"]
    )
    assert upgraded.status_code == 200
    assert upgraded.json()["tier"] == "pro"
    assert upgraded.json()["plan"]["id"] == "pro"
    assert upgraded.json()["usage"]["workspaces"]["limit"] == 10

    persisted = client.get(f"{BILLING}/subscription", headers=user["headers"]).json()
    assert persisted["tier"] == "pro"
    assert client.get("/api/v1/auth/me", headers=user["headers"]).json()["tier"] == "pro"

    downgraded = client.post(
        f"{BILLING}/subscription", json={"tier": "free"}, headers=user["headers"]
    )
    assert downgraded.json()["tier"] == "free"


def test_change_plan_invalid_tier(client, make_user):
    user = make_user()
    response = client.post(
        f"{BILLING}/subscription", json={"tier": "platinum"}, headers=user["headers"]
    )
    assert response.status_code == 422
