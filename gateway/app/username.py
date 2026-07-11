# Copyright 2017-present, The Visdom Authors
# All rights reserved.
#
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

"""
Username validation and generation helpers. Usernames are lowercase,
3-30 chars, and may contain letters, digits, underscores, and hyphens.
"""

import re
import secrets

from sqlalchemy.orm import Session

USERNAME_PATTERN = re.compile(r"^[a-z0-9_-]{3,30}$")

_ADJECTIVES = [
    "swift", "brave", "clever", "quiet", "bright", "calm", "bold", "sunny",
    "gentle", "lucky", "misty", "nimble", "sharp", "steady", "vivid", "witty",
    "amber", "cosmic", "electric", "golden", "silver", "velvet", "crimson", "azure",
]

_NOUNS = [
    "falcon", "otter", "panda", "tiger", "comet", "maple", "harbor", "canyon",
    "meadow", "raven", "dolphin", "lynx", "glacier", "ember", "orchid", "willow",
    "voyager", "compass", "lantern", "beacon", "summit", "horizon", "cascade", "prism",
]


def normalize_username(raw: str) -> str:
    """Lowercases and strips a username so equivalent inputs compare equal."""
    return raw.strip().lower()


def is_valid_username_format(username: str) -> bool:
    return bool(USERNAME_PATTERN.match(username))


def _slugify_seed(seed: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", seed.lower()).strip("-")
    return slug[:20]


def _random_candidate(seed: str | None) -> str:
    if seed:
        base = _slugify_seed(seed)
        if base and len(base) >= 3:
            return f"{base}-{secrets.randbelow(9000) + 100}"

    adjective = secrets.choice(_ADJECTIVES)
    noun = secrets.choice(_NOUNS)
    return f"{adjective}-{noun}-{secrets.randbelow(900) + 100}"


def generate_unique_username(db: Session, seed: str | None = None) -> str:
    """Generates a username guaranteed not to collide with an existing row."""
    from app.models import User  

    for _ in range(20):
        candidate = _random_candidate(seed)
        if not is_valid_username_format(candidate):
            continue
        exists = db.query(User).filter(User.username == candidate).first()
        if not exists:
            return candidate

    return f"user-{secrets.token_hex(6)}"
