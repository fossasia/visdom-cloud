# Copyright 2017-present, The Visdom Authors
# All rights reserved.
#
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

"""
Email-sending stub for Visdom.
"""

import logging

from app.config import settings

logger = logging.getLogger("visdom.email")


# TODO: wire up a real email provider here.
def send_workspace_invite_email(to_email: str, workspace_name: str, invite_url: str) -> None:
    logger.info(
        "[email stub] Would send workspace invite to %s: join '%s' via %s",
        to_email,
        workspace_name,
        invite_url,
    )


def build_share_link_url(link_id) -> str:
    return f"{settings.FRONTEND_URL}/share/{link_id}"
