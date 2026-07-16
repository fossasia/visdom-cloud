# Copyright 2017-present, The Visdom Authors
# All rights reserved.
#
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

"""
Subscription plan catalog and per-tier limits. Single source of truth for the
billing page, so plans/limits are backend-driven rather than hardcoded in the UI.
A `None` limit means unlimited.
"""

PLANS = {
    "free": {
        "id": "free",
        "name": "Free",
        "price": 0,
        "limits": {"workspaces": 1, "members": 3, "api_keys": 2},
        "retention_days": 7,
        "features": [
            "1 workspace",
            "3 team members",
            "7-day log retention",
            "Community support",
        ],
    },
    "pro": {
        "id": "pro",
        "name": "Pro",
        "price": 29,
        "limits": {"workspaces": 10, "members": None, "api_keys": 20},
        "retention_days": 90,
        "features": [
            "10 workspaces",
            "Unlimited members",
            "90-day log retention",
            "Priority support",
            "Shared links",
        ],
    },
    "enterprise": {
        "id": "enterprise",
        "name": "Enterprise",
        "price": None,
        "limits": {"workspaces": None, "members": None, "api_keys": None},
        "retention_days": None,
        "features": [
            "Unlimited workspaces",
            "SSO & audit logs",
            "Unlimited retention",
            "Dedicated support",
            "Custom SLAs",
        ],
    },
}

PLAN_ORDER = ["free", "pro", "enterprise"]
DEFAULT_TIER = "free"


def get_plan(tier):
    return PLANS.get(tier, PLANS[DEFAULT_TIER])


def ordered_plans():
    return [PLANS[tier] for tier in PLAN_ORDER]
