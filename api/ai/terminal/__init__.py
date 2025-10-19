"""
Terminal server module for SLAR AI.

This module provides standalone terminal server functionality.
Note: Terminal routes should be handled by terminal_server.py separately,
not imported into the main API application.
"""

from .terminal import Terminal

__all__ = ["Terminal"]
