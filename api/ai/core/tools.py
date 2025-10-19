import asyncio
import os
import json
import yaml
from typing import List, Dict, Any, Optional, Union
from autogen_ext.tools.mcp import (
    StdioServerParams, 
    mcp_server_tools, 
    StreamableHttpMcpToolAdapter, 
    StreamableHttpServerParams,
    McpWorkbench
)


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
        self.tools = []
        self.mcp_servers: List[MCPServerConfig] = []
        self.server_tools: Dict[str, List] = {}
        self.workbenches: Dict[str, McpWorkbench] = {}  # Store workbenches by server name

    def add_tool(self, tool):
        """Add a single tool to the manager"""
        self.tools.append(tool)

    def get_tools(self):
        """Get all loaded tools"""
        return self.tools

    def clear_tools(self):
        """Clear all tools and workbenches"""
        self.tools = []
        self.server_tools = {}
        # Close all workbenches properly
        for workbench in self.workbenches.values():
            try:
                # Note: workbenches should be closed in async context
                pass  # We'll handle this in async methods
            except Exception as e:
                print(f"Warning: Error closing workbench: {e}")
        self.workbenches = {}

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
            print(f"Config file {config_path} not found. Using default configuration.")
            return self.get_default_config()
        except Exception as e:
            print(f"Error loading config: {e}. Using default configuration.")
            return self.get_default_config()

    def get_default_config(self) -> List[MCPServerConfig]:
        """Fallback default configuration - tries multiple config files"""
        # Try alternative config file locations
        default_config_paths = [
            "data/mcp_config.yaml",
            "data/mcp_config.json",
            "mcp_config.yaml",
            "mcp_config.json"
        ]

        for config_path in default_config_paths:
            try:
                print(f"Trying fallback config: {config_path}")
                servers = self._load_config_from_file(config_path)
                print(f"✓ Loaded fallback configuration from {config_path}")
                return servers
            except (FileNotFoundError, Exception) as e:
                print(f"  Failed to load {config_path}: {e}")
                continue

        # If no config files found, create minimal default
        print("No config files found, using minimal default configuration")
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

    def configure_server(self, name: str, enabled: Optional[bool] = None) -> Optional[MCPServerConfig]:
        """Enable or disable a specific MCP server"""
        for server in self.mcp_servers:
            if server.name == name:
                if enabled is not None:
                    server.enabled = enabled
                return server
        return None

    def list_servers(self):
        """List all configured MCP servers and their status"""
        print("Configured MCP Servers:")
        for server in self.mcp_servers:
            print(f"  {server}")
        print()

    async def load_mcp_workbenches(self) -> Dict[str, McpWorkbench]:
        """Load McpWorkbench instances for all enabled MCP servers"""
        workbenches = {}
        
        for server in self.mcp_servers:
            if not server.enabled:
                print(f"Skipping disabled server: {server.name}")
                continue
                
            try:
                print(f"Creating workbench for {server.name} ({server.server_type})...")
                
                # Create workbench with server params
                workbench = McpWorkbench(server_params=server.params)
                
                # Start the workbench
                await workbench.start()
                
                workbenches[server.name] = workbench
                print(f"✓ Created workbench for {server.name}")
                
                # Try to list tools to verify connection
                try:
                    tools = await workbench.list_tools()
                    tool_names = [tool.get('name', 'unknown') for tool in tools]
                    self.server_tools[server.name] = tool_names
                    print(f"  Available tools: {', '.join(tool_names[:5])}")
                    if len(tool_names) > 5:
                        print(f"  ... and {len(tool_names) - 5} more")
                except Exception as e:
                    print(f"  Warning: Could not list tools for {server.name}: {e}")
                    self.server_tools[server.name] = []
                    
            except Exception as e:
                print(f"✗ Failed to create workbench for {server.name}: {e}")
                import traceback
                print(f"  Error details: {traceback.format_exc()}")
                continue
                
        self.workbenches = workbenches
        print(f"\nTotal workbenches created: {len(workbenches)}")
        return workbenches

    def get_workbench(self, server_name: str) -> Optional[McpWorkbench]:
        """Get workbench for a specific server"""
        return self.workbenches.get(server_name)
    
    def get_all_workbenches(self) -> Dict[str, McpWorkbench]:
        """Get all workbenches"""
        return self.workbenches.copy()

    async def close_workbenches(self):
        """Close all workbenches properly"""
        for server_name, workbench in self.workbenches.items():
            try:
                print(f"Closing workbench for {server_name}...")
                await workbench.stop()
            except Exception as e:
                print(f"Warning: Error closing workbench for {server_name}: {e}")
        self.workbenches = {}

    async def load_mcp_tools(self) -> List[Any]:
        """Load tools from all enabled MCP servers (both stdio and HTTP)"""
        all_tools = []

        for server in self.mcp_servers:
            if not server.enabled:
                print(f"Skipping disabled server: {server.name}")
                continue

            try:
                print(f"Loading tools from {server.name} ({server.server_type})...")
                
                if server.server_type == "http":
                    # Use StreamableHttpMcpToolAdapter for HTTP servers
                    print(f"  Connecting to HTTP server at {server.url}...")
                    # Create a tool adapter for the HTTP server
                    try:
                        # The from_server_params method returns a tool adapter that needs to be awaited
                        adapter = await asyncio.wait_for(
                            StreamableHttpMcpToolAdapter.from_server_params(server.params, ""),
                            timeout=server.timeout
                        )
                        
                        # For HTTP servers, we treat the adapter as a single "meta-tool"
                        # that can handle multiple tool calls to the server
                        tools = [adapter]
                        
                    except Exception as e:
                        print(f"  Failed to create HTTP adapter for {server.name}: {e}")
                        continue
                    
                elif server.server_type == "stdio":
                    # Use mcp_server_tools for stdio servers
                    print(f"  Starting stdio server: {server.command} {' '.join(server.args)}")
                    tools = await asyncio.wait_for(
                        mcp_server_tools(server.params),
                        timeout=server.timeout
                    )
                else:
                    print(f"  Unknown server type: {server.server_type}")
                    continue
                    
                all_tools.extend(tools)
                
                # Handle tool names differently for HTTP vs stdio
                if server.server_type == "http":
                    # For HTTP servers, we might not know all tool names upfront
                    self.server_tools[server.name] = [f"{server.name}_http_adapter"]
                    print(f"✓ Created HTTP adapter for {server.name}")
                    print(f"  HTTP adapter ready for tool calls")
                else:
                    # For stdio servers, we can get the actual tool names
                    self.server_tools[server.name] = [getattr(tool, 'name', str(tool)) for tool in tools]
                    print(f"✓ Loaded {len(tools)} tools from {server.name}")
                    
                    # Show available tools for stdio servers
                    if tools:
                        tool_names = [getattr(tool, 'name', str(tool)) for tool in tools]
                        print(f"  Available tools: {', '.join(tool_names)}")

            except asyncio.TimeoutError:
                print(f"✗ Failed to load {server.name}: Connection timeout after {server.timeout} seconds")
                continue
            except Exception as e:
                print(f"✗ Failed to load {server.name}: {e}")
                # Print more detailed error info for debugging
                import traceback
                print(f"  Error details: {traceback.format_exc()}")
                continue

        self.tools = all_tools
        print(f"\nTotal tools loaded: {len(all_tools)}")
        return all_tools

    def get_server_tools(self, server_name: str) -> List[str]:
        """Get list of tool names for a specific server"""
        return self.server_tools.get(server_name, [])

    def get_all_server_tools(self) -> Dict[str, List[str]]:
        """Get dictionary of all server tools"""
        return self.server_tools.copy()

    def create_default_config_file(self, config_path: str = "ai/mcp_config_default.yaml"):
        """Create a default configuration file"""
        default_config = {
            "augment.advanced": {
                "mcpServers": [
                    {
                        "name": "filesystem",
                        "command": "npx",
                        "args": ["-y", "@modelcontextprotocol/server-filesystem", "./"]
                    },
                    {
                        "name": "context7",
                        "command": "npx",
                        "args": ["-y", "@upstash/context7-mcp@latest", "--api-key", "YOUR_API_KEY"]
                    }
                ]
            }
        }

        try:
            import os
            dir_path = os.path.dirname(config_path)
            if dir_path:  # Only create directory if there is one
                os.makedirs(dir_path, exist_ok=True)

            if config_path.endswith('.yaml') or config_path.endswith('.yml'):
                with open(config_path, 'w') as f:
                    yaml.dump(default_config, f, default_flow_style=False, indent=2)
            else:
                with open(config_path, 'w') as f:
                    json.dump(default_config, f, indent=2)

            print(f"✓ Created default configuration file: {config_path}")
            return True
        except Exception as e:
            print(f"✗ Failed to create default config file: {e}")
            return False
