# Copyright 2017-present, The Visdom Authors
import re

AUTH = "/api/v1/auth"
USERNAME_PATTERN = re.compile(r"^[a-z0-9_-]{3,30}$")


def test_register_generates_username(client):
    response = client.post(
        f"{AUTH}/register", json={"email": "hello@example.com", "password": "securepassword"}
    )
    assert response.status_code == 201
    username = response.json()["username"]
    assert USERNAME_PATTERN.match(username)
    assert username.startswith("hello-")


def test_register_with_chosen_username(client, make_user):
    user = make_user(username="my-cool-name")
    assert user["username"] == "my-cool-name"

    taken = client.post(
        f"{AUTH}/register",
        json={"email": "other@example.com", "password": "securepassword", "username": "my-cool-name"},
    )
    assert taken.status_code == 400
    assert taken.json()["detail"] == "This username is already taken."

    invalid = client.post(
        f"{AUTH}/register",
        json={"email": "third@example.com", "password": "securepassword", "username": "ab"},
    )
    assert invalid.status_code == 422


def test_username_availability(client, make_user):
    make_user(username="taken-name")

    taken = client.get(f"{AUTH}/username-availability", params={"username": "taken-name"})
    assert taken.json() == {"available": False}

    case_insensitive = client.get(
        f"{AUTH}/username-availability", params={"username": "TAKEN-NAME"}
    )
    assert case_insensitive.json() == {"available": False}

    free = client.get(f"{AUTH}/username-availability", params={"username": "totally-free-name"})
    assert free.json() == {"available": True}

    invalid = client.get(f"{AUTH}/username-availability", params={"username": "x!"})
    assert invalid.json() == {"available": False}


def test_generate_username_suggestion(client):
    seeded = client.get(f"{AUTH}/generate-username", params={"seed": "Alice Smith"})
    assert seeded.status_code == 200
    assert seeded.json()["username"].startswith("alice-smith-")
    assert USERNAME_PATTERN.match(seeded.json()["username"])

    unseeded = client.get(f"{AUTH}/generate-username")
    assert unseeded.status_code == 200
    assert USERNAME_PATTERN.match(unseeded.json()["username"])


def test_update_username(client, make_user):
    user = make_user()
    other = make_user(username="occupied-name")

    renamed = client.patch(
        f"{AUTH}/me/username", json={"username": "brand-new-name"}, headers=user["headers"]
    )
    assert renamed.status_code == 200
    assert renamed.json()["username"] == "brand-new-name"
    assert client.get(f"{AUTH}/me", headers=user["headers"]).json()["username"] == "brand-new-name"

    resubmitted = client.patch(
        f"{AUTH}/me/username", json={"username": "brand-new-name"}, headers=user["headers"]
    )
    assert resubmitted.status_code == 200

    collision = client.patch(
        f"{AUTH}/me/username", json={"username": other["username"]}, headers=user["headers"]
    )
    assert collision.status_code == 400
    assert collision.json()["detail"] == "This username is already taken."

    invalid = client.patch(
        f"{AUTH}/me/username", json={"username": "NO CAPS ALLOWED"}, headers=user["headers"]
    )
    assert invalid.status_code == 422

    anonymous = client.patch(f"{AUTH}/me/username", json={"username": "someone-else"})
    assert anonymous.status_code == 401
