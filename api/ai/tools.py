import asyncio
import os
import json
import yaml
from typing import List, Dict, Any, Optional
from autogen_ext.tools.mcp import StdioServerParams, mcp_server_tools


class MCPServerConfig:
    """Configuration for a single MCP server"""
    def __init__(self, name: str, command: str, args: List[str], env: Dict[str, str], enabled: bool = True):
        self.name = name
        self.command = command
        self.args = args
        self.enabled = enabled
        self.env = env
        self.params = StdioServerParams(command=command, args=args, env=env)

    def __repr__(self):
        status = "✓ Enabled" if self.enabled else "✗ Disabled"
        return f"MCPServerConfig({self.name}: {status})"


class ToolManager:
    def __init__(self):
        self.tools = []
        self.mcp_servers: List[MCPServerConfig] = []
        self.server_tools: Dict[str, List] = {}

    def add_tool(self, tool):
        """Add a single tool to the manager"""
        self.tools.append(tool)

    def get_tools(self):
        """Get all loaded tools"""
        return self.tools

    def clear_tools(self):
        """Clear all tools"""
        self.tools = []
        self.server_tools = {}

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
            # Get base args from config
            args = server_config.get("args", [])

            # For context7, add API key if available
            if server_config["name"] == "context7":
                context7_api_key = os.getenv("CONTEXT7_API_KEY")
                if context7_api_key:
                    args = args + ["--api-key", context7_api_key]

            enabled = os.getenv(f"ENABLE_{server_config['name'].upper()}", "true").lower() == "true"

            server = MCPServerConfig(
                name=server_config["name"],
                command=server_config["command"],
                args=args,
                env=server_config.get("env", {}),
                enabled=enabled
            )
            servers.append(server)

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

    async def load_mcp_tools(self) -> List[Any]:
        """Load tools from all enabled MCP servers"""
        all_tools = []

        for server in self.mcp_servers:
            if not server.enabled:
                print(f"Skipping disabled server: {server.name}")
                continue

            try:
                print(f"Loading tools from {server.name}...")
                # Add timeout to prevent hanging
                tools = await asyncio.wait_for(
                    mcp_server_tools(server.params),
                    timeout=30.0
                )
                all_tools.extend(tools)
                self.server_tools[server.name] = [tool.name for tool in tools]
                print(f"✓ Loaded {len(tools)} tools from {server.name}")

                # Show available tools for this server
                if tools:
                    print(f"  Available tools: {', '.join([tool.name for tool in tools])}")

            except asyncio.TimeoutError:
                print(f"✗ Failed to load {server.name}: Connection timeout after 30 seconds")
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
