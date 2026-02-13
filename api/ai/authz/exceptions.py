"""
Custom authorization exceptions.
"""


class AuthzError(Exception):
    """Base authorization error."""

    def __init__(self, message: str = "Authorization error"):
        self.message = message
        super().__init__(self.message)


class UnauthorizedError(AuthzError):
    """User is not authenticated (401)."""

    def __init__(self, message: str = "Authentication required"):
        super().__init__(message)


class ForbiddenError(AuthzError):
    """User does not have permission (403)."""

    def __init__(self, message: str = "Insufficient permissions"):
        super().__init__(message)


class MissingContextError(AuthzError):
    """Required context (org_id, project_id) is missing (400)."""

    def __init__(self, field: str):
        super().__init__(f"Missing required context: {field}")
        self.field = field
