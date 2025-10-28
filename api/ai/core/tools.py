"""
Tool management and MCP integration for SLAR AI system.
"""

import asyncio
import os
import json
import logging
from typing import List, Dict, Any, Optional

import yaml
from autogen_ext.tools.mcp import (
    StdioServerParams,
    StreamableHttpServerParams,
    McpWorkbench
)

logger = logging.getLogger(__name__)


class MCPServerConfig:
    """Configuration for a single MCP server (supports both stdio and HTTP)"""
    def __init__(self, name: str, command: Optional[str] = None, args: Optional[List[str]] = None, 
                 env: Optional[Dict[str, str]] = None, url: Optional[str] = None, 
                 headers: Optional[Dict[str, str]] = None, timeout: Optional[float] = None,
                 terminate_on_close: bool = True, enabled: bool = True):
        self.name = name
        self.command = command
        self.args = args or []
        self.env = env or {}
        self.url = url
        self.headers = headers or {}
        self.timeout = timeout or 30.0
        self.terminate_on_close = terminate_on_close
        self.enabled = enabled
        
        # Create appropriate params based on server type
        if url:
            # HTTP-based server
            self.server_type = "http"
            self.params = StreamableHttpServerParams(
                url=url,
                headers=headers or {},
                timeout=timeout or 30.0,
                sse_read_timeout=300.0,  # Default 5 minutes for SSE
                terminate_on_close=terminate_on_close
            )
        elif command:
            # Command-based server (stdio)
            self.server_type = "stdio"
            self.params = StdioServerParams(command=command, args=args or [], env=env or {})
        else:
            raise ValueError(f"Server {name} must have either 'command' or 'url' specified")

    def __repr__(self):
        status = "✓ Enabled" if self.enabled else "✗ Disabled"
        server_info = f"URL: {self.url}" if self.server_type == "http" else f"Command: {self.command}"
        return f"MCPServerConfig({self.name} [{self.server_type}]: {status}, {server_info})"


class ToolManager:
    def __init__(self):
        self.mcp_servers: List[MCPServerConfig] = []
        self.server_tools: Dict[str, List] = {}
        self.workbenches: Dict[str, McpWorkbench] = {}  # Store workbenches by server name

    def _load_config_from_file(self, config_path: str) -> List[MCPServerConfig]:
        """Internal method to load config from a specific file"""
        with open(config_path, 'r') as file:
            content = file.read()

        # Try to parse as JSON first, then YAML
        try:
            config = json.loads(content)
        except json.JSONDecodeError:
            config = yaml.safe_load(content)

        # Extract mcpServers from the nested structure
        mcp_servers_config = config.get("slar.advanced", {}).get("mcpServers", [])

        # Convert to our internal format with environment variable substitution
        servers = []
        for server_config in mcp_servers_config:
            # Each server config can be either a dict with server name as key, or a simple dict
            if len(server_config) == 1 and isinstance(list(server_config.values())[0], dict):
                # Format: {"kubernetes": {"url": "...", "headers": {...}}}
                server_name = list(server_config.keys())[0]
                server_data = server_config[server_name]
            else:
                # Format: {"name": "kubernetes", "url": "...", "headers": {...}}
                server_name = server_config.get("name")
                server_data = server_config
                
            if not server_name:
                print(f"Warning: Skipping server config without name: {server_config}")
                continue

            
            # Extract server parameters
            command = server_data.get("command")
            args = server_data.get("args", [])
            env = server_data.get("env", {})
            url = server_data.get("url")
            headers = server_data.get("headers", {})
            timeout = server_data.get("timeout", 30.0)
            terminate_on_close = server_data.get("terminate_on_close", True)

            try:
                server = MCPServerConfig(
                    name=server_name,
                    command=command,
                    args=args,
                    env=env,
                    url=url,
                    headers=headers,
                    timeout=timeout,
                    terminate_on_close=terminate_on_close,
                    enabled=True
                )
                servers.append(server)
            except ValueError as e:
                print(f"Warning: Invalid server config for {server_name}: {e}")
                continue

        self.mcp_servers = servers
        return servers

    def load_mcp_config(self, config_path: str = "mcp_config.yaml") -> List[MCPServerConfig]:
        """Load MCP server configuration from YAML or JSON file"""
        try:
            servers = self._load_config_from_file(config_path)
            print(f"✓ Loaded configuration for {len(servers)} MCP servers from {config_path}")
            return servers

        except FileNotFoundError:
            logger.warning(f"Config file {config_path} not found. Using default configuration.")
            return self.get_default_config()
        except Exception as e:
            logger.error(f"Error loading config: {e}. Using default configuration.")
            return self.get_default_config()

    def get_default_config(self) -> List[MCPServerConfig]:
        """Fallback default configuration - tries multiple config files"""
        default_config_paths = [
            "data/mcp_config.yaml",
            "data/mcp_config.json",
            "mcp_config.yaml",
            "mcp_config.json"
        ]

        for config_path in default_config_paths:
            try:
                logger.info(f"Trying fallback config: {config_path}")
                servers = self._load_config_from_file(config_path)
                logger.info(f"Loaded fallback configuration from {config_path}")
                return servers
            except Exception as e:
                logger.debug(f"Failed to load {config_path}: {e}")
                continue

        # If no config files found, create minimal default
        logger.info("No config files found, using minimal default configuration")
        servers = [
            MCPServerConfig(
                name="filesystem",
                command="npx",
                args=["-y", "@modelcontextprotocol/server-filesystem", "./"],
                enabled=os.getenv("ENABLE_FILESYSTEM", "true").lower() == "true"
            )
        ]
        self.mcp_servers = servers
        return servers

    async def load_mcp_workbenches(self) -> Dict[str, McpWorkbench]:
        """Load McpWorkbench instances for all enabled MCP servers"""
        workbenches = {}

        for server in self.mcp_servers:
            if not server.enabled:
                logger.info(f"Skipping disabled server: {server.name}")
                continue

            try:
                logger.info(f"Creating workbench for {server.name} ({server.server_type})...")

                # Create and start workbench
                workbench = McpWorkbench(server_params=server.params)
                await workbench.start()
                workbenches[server.name] = workbench
                logger.info(f"Created workbench for {server.name}")

                # Try to list tools to verify connection
                try:
                    tools = await workbench.list_tools()
                    tool_names = [tool.get('name', 'unknown') for tool in tools]
                    self.server_tools[server.name] = tool_names
                    logger.info(f"  Available tools: {', '.join(tool_names[:5])}")
                    if len(tool_names) > 5:
                        logger.info(f"  ... and {len(tool_names) - 5} more")
                except Exception as e:
                    logger.warning(f"Could not list tools for {server.name}: {e}")
                    self.server_tools[server.name] = []

            except Exception as e:
                logger.error(f"Failed to create workbench for {server.name}: {e}")
                continue

        self.workbenches = workbenches
        logger.info(f"Total workbenches created: {len(workbenches)}")
        return workbenches
