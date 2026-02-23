"""
Shared test data and mock helpers for authz tests.

Defines deterministic UUIDs, mock memberships, and reference implementations
for verifying authorization logic.
"""

# ============================================================
# Test UUIDs (deterministic for reproducibility)
# ============================================================

# Organizations
ORG_ALPHA_ID = "00000000-0000-0000-0000-000000000001"
ORG_BETA_ID = "00000000-0000-0000-0000-000000000002"

# Projects
PROJECT_WEB_ID = "10000000-0000-0000-0000-000000000001"  # In org_alpha, has explicit members
PROJECT_API_ID = "10000000-0000-0000-0000-000000000002"  # In org_alpha, "open" (no explicit members)
PROJECT_BETA_ID = "10000000-0000-0000-0000-000000000003"  # In org_beta

# Users
USER_ORG_OWNER_ID = "20000000-0000-0000-0000-000000000001"   # owner of org_alpha
USER_ORG_ADMIN_ID = "20000000-0000-0000-0000-000000000002"   # admin of org_alpha
USER_ORG_MEMBER_ID = "20000000-0000-0000-0000-000000000003"  # member of org_alpha
USER_ORG_VIEWER_ID = "20000000-0000-0000-0000-000000000004"  # viewer of org_alpha
USER_PROJECT_ADMIN_ID = "20000000-0000-0000-0000-000000000005"  # explicit admin of project_web
USER_PROJECT_MEMBER_ID = "20000000-0000-0000-0000-000000000006"  # explicit member of project_web
USER_OUTSIDER_ID = "20000000-0000-0000-0000-000000000099"  # no memberships at all


# ============================================================
# Mock Database
# ============================================================

# Simulates the memberships table
MOCK_MEMBERSHIPS = [
    # Org Alpha memberships
    {"user_id": USER_ORG_OWNER_ID, "resource_type": "org", "resource_id": ORG_ALPHA_ID, "role": "owner"},
    {"user_id": USER_ORG_ADMIN_ID, "resource_type": "org", "resource_id": ORG_ALPHA_ID, "role": "admin"},
    {"user_id": USER_ORG_MEMBER_ID, "resource_type": "org", "resource_id": ORG_ALPHA_ID, "role": "member"},
    {"user_id": USER_ORG_VIEWER_ID, "resource_type": "org", "resource_id": ORG_ALPHA_ID, "role": "viewer"},

    # Project Web explicit memberships (project is "closed" - has explicit members)
    {"user_id": USER_PROJECT_ADMIN_ID, "resource_type": "project", "resource_id": PROJECT_WEB_ID, "role": "admin"},
    {"user_id": USER_PROJECT_MEMBER_ID, "resource_type": "project", "resource_id": PROJECT_WEB_ID, "role": "member"},

    # Project API has NO explicit members (project is "open")
]

# Simulates the projects table
MOCK_PROJECTS = [
    {"id": PROJECT_WEB_ID, "organization_id": ORG_ALPHA_ID, "name": "Web App", "slug": "web-app"},
    {"id": PROJECT_API_ID, "organization_id": ORG_ALPHA_ID, "name": "API Service", "slug": "api-service"},
    {"id": PROJECT_BETA_ID, "organization_id": ORG_BETA_ID, "name": "Beta Project", "slug": "beta-project"},
]


# ============================================================
# Mock Query Helpers
# ============================================================

def mock_get_org_membership(user_id: str, org_id: str):
    """Simulate: SELECT role FROM memberships WHERE user_id=$1 AND resource_type='org' AND resource_id=$2"""
    for m in MOCK_MEMBERSHIPS:
        if m["user_id"] == user_id and m["resource_type"] == "org" and m["resource_id"] == org_id:
            return {"role": m["role"]}
    return None


def mock_get_project_org_id(project_id: str):
    """Simulate: SELECT organization_id FROM projects WHERE id=$1"""
    for p in MOCK_PROJECTS:
        if p["id"] == project_id:
            return p["organization_id"]
    return None


def mock_project_has_explicit_members(project_id: str) -> bool:
    """Simulate: EXISTS(SELECT 1 FROM memberships WHERE resource_type='project' AND resource_id=$1)"""
    return any(
        m["resource_type"] == "project" and m["resource_id"] == project_id
        for m in MOCK_MEMBERSHIPS
    )


def mock_get_explicit_project_membership(user_id: str, project_id: str):
    """Simulate: SELECT role FROM memberships WHERE user_id=$1 AND resource_type='project' AND resource_id=$2"""
    for m in MOCK_MEMBERSHIPS:
        if m["user_id"] == user_id and m["resource_type"] == "project" and m["resource_id"] == project_id:
            return {"role": m["role"]}
    return None


def mock_get_project_role_full(user_id: str, project_id: str):
    """
    Reference implementation of GetProjectRole logic from Go's simple.go.

    This is the EXPECTED behavior - used to validate our test expectations
    before implementing the real authorizer.

    Priority:
      0: Org owner/admin -> always admin on all projects in org
      1: Explicit project membership -> use that role
      2: Org member/viewer -> inherit ONLY if project is "open" (no explicit members)
    """
    # Get project's org_id
    org_id = mock_get_project_org_id(project_id)
    if org_id is None:
        return None  # Project doesn't exist

    has_explicit_members = mock_project_has_explicit_members(project_id)

    # Priority 0: Org owner/admin -> ALWAYS admin
    org_membership = mock_get_org_membership(user_id, org_id)
    if org_membership and org_membership["role"] in ("owner", "admin"):
        return "admin"  # Inherited as admin

    # Priority 1: Explicit project membership
    explicit = mock_get_explicit_project_membership(user_id, project_id)
    if explicit:
        return explicit["role"]

    # Priority 2: Org member/viewer -> inherit ONLY if project is "open"
    if org_membership and org_membership["role"] not in ("owner", "admin"):
        if not has_explicit_members:
            return org_membership["role"]  # Inherit org role

    return None  # No access
