#!/usr/bin/env python3
"""
Example demonstrating how to use McpWorkbench pattern with SLAR ToolManager
This shows the recommended approach for using MCP servers with AutoGen agents
"""

import asyncio
import os
from tools import ToolManager
from autogen_ext.models.openai import OpenAIChatCompletionClient
from autogen_agentchat.agents import AssistantAgent

async def example_workbench_usage():
    """Example showing how to use workbench with AutoGen agents"""
    print("=" * 60)
    print("McpWorkbench Usage Example")
    print("=" * 60)
    
    # Initialize tool manager and load config
    tool_manager = ToolManager()
    tool_manager.load_mcp_config("mcp_config.yaml")
    
    # Create workbenches for all servers
    print("\n1. Creating workbenches...")
    workbenches = await tool_manager.load_mcp_workbenches()
    
    if not workbenches:
        print("No workbenches created. Please check your MCP server configuration.")
        return
    
    # Example 1: Using workbench directly
    print("\n2. Direct workbench usage...")
    for server_name, workbench in workbenches.items():
        print(f"\nTesting {server_name} workbench:")
        
        try:
            # List available tools
            tools = await workbench.list_tools()
            print(f"  Available tools: {len(tools)}")
            
            for tool in tools[:2]:  # Show first 2 tools
                tool_name = tool.get('name', 'unknown')
                tool_desc = tool.get('description', 'No description')
                print(f"    - {tool_name}: {tool_desc}")
            
            if len(tools) > 2:
                print(f"    ... and {len(tools) - 2} more")
                
        except Exception as e:
            print(f"  Error: {e}")
    
    # Example 2: Using workbench with AutoGen Agent (if OpenAI key available)
    print("\n3. AutoGen Agent integration example...")
    
    # Check if OpenAI API key is available
    if os.getenv("OPENAI_API_KEY"):
        try:
            # Create model client
            model_client = OpenAIChatCompletionClient(model="gpt-4o-mini")
            
            # Get first available workbench
            first_server = list(workbenches.keys())[0]
            workbench = workbenches[first_server]
            
            print(f"  Using workbench from: {first_server}")
            
            # Create agent with workbench
            agent = AssistantAgent(
                name="mcp_agent",
                model_client=model_client,
                workbench=workbench,
                system_message=f"You are a helpful assistant with access to tools from {first_server}."
            )
            
            print("  ✓ Agent created with workbench")
            print("  Note: Agent is ready to use MCP tools in conversations")
            
            # Close model client
            await model_client.close()
            
        except Exception as e:
            print(f"  Could not create AutoGen agent: {e}")
            print("  This is normal if OpenAI API key is not configured")
    else:
        print("  Skipping AutoGen integration (no OPENAI_API_KEY)")
        print("  Set OPENAI_API_KEY environment variable to test agent integration")
    
    # Example 3: Multiple workbenches
    print("\n4. Multiple workbench usage...")
    if len(workbenches) > 1:
        print("  You can use multiple workbenches simultaneously:")
        for server_name in workbenches.keys():
            wb = tool_manager.get_workbench(server_name)
            if wb:
                print(f"    - {server_name}: Ready")
    else:
        print("  Only one workbench available")
    
    # Clean up
    print("\n5. Cleanup...")
    await tool_manager.close_workbenches()
    print("  ✓ All workbenches closed properly")
    
    print("\n" + "=" * 60)
    print("Example Complete")
    print("=" * 60)

async def example_context_manager_usage():
    """Example showing proper context manager usage"""
    print("\n" + "=" * 60)
    print("Context Manager Usage Example")
    print("=" * 60)
    
    tool_manager = ToolManager()
    tool_manager.load_mcp_config("mcp_config.yaml")
    
    # Get first server config for demonstration
    if not tool_manager.mcp_servers:
        print("No MCP servers configured")
        return
    
    first_server = tool_manager.mcp_servers[0]
    if not first_server.enabled:
        print("First server is disabled")
        return
    
    print(f"\nDemonstrating context manager with {first_server.name}...")
    
    # Use workbench as context manager (recommended pattern)
    from autogen_ext.tools.mcp import McpWorkbench
    
    try:
        async with McpWorkbench(server_params=first_server.params) as workbench:
            print("  ✓ Workbench started automatically")
            
            # Use workbench
            tools = await workbench.list_tools()
            print(f"  Available tools: {len(tools)}")
            
            # Workbench will be closed automatically when exiting context
        
        print("  ✓ Workbench closed automatically")
        
    except Exception as e:
        print(f"  Error: {e}")
    
    print("\nContext manager ensures proper cleanup!")

def print_usage_patterns():
    """Print different usage patterns"""
    print("\n" + "=" * 60)
    print("McpWorkbench Usage Patterns")
    print("=" * 60)
    
    patterns = [
        {
            "name": "1. Direct Tool Manager (Current)",
            "description": "Use ToolManager to manage multiple workbenches",
            "code": """
tool_manager = ToolManager()
tool_manager.load_mcp_config("mcp_config.yaml")
workbenches = await tool_manager.load_mcp_workbenches()
workbench = tool_manager.get_workbench("kubernetes")
"""
        },
        {
            "name": "2. Context Manager (Recommended)",
            "description": "Use workbench as context manager for single server",
            "code": """
from autogen_ext.tools.mcp import McpWorkbench, StdioServerParams

params = StdioServerParams(command="npx", args=["-y", "@upstash/context7-mcp"])
async with McpWorkbench(server_params=params) as workbench:
    tools = await workbench.list_tools()
    result = await workbench.call_tool("tool_name", {"arg": "value"})
"""
        },
        {
            "name": "3. AutoGen Agent Integration",
            "description": "Pass workbench to AutoGen agent",
            "code": """
agent = AssistantAgent(
    name="agent",
    model_client=model_client,
    workbench=workbench,  # Single workbench
    # OR
    workbench=[wb1, wb2, wb3],  # Multiple workbenches
)
"""
        }
    ]
    
    for pattern in patterns:
        print(f"\n{pattern['name']}:")
        print(f"  {pattern['description']}")
        print(f"  Code:")
        for line in pattern['code'].strip().split('\n'):
            print(f"    {line}")

if __name__ == "__main__":
    # Set environment variables
    os.environ.setdefault("CONTEXT7_API_KEY", "ctx7sk-9dfa3d11-51ca-4ea9-a7fc-0150630879ee")
    
    print("McpWorkbench Usage Examples")
    print("===========================")
    
    # Print usage patterns first
    print_usage_patterns()
    
    # Run examples
    print("\n" + "=" * 60)
    print("Running Examples...")
    print("=" * 60)
    
    asyncio.run(example_workbench_usage())
    asyncio.run(example_context_manager_usage())
