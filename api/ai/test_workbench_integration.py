#!/usr/bin/env python3
"""
Test script for McpWorkbench integration
Tests the new workbench-based approach alongside the direct tool loading
"""

import asyncio
import os
import sys
from tools import ToolManager

async def test_workbench_integration():
    """Test the new McpWorkbench integration"""
    print("=" * 60)
    print("Testing McpWorkbench Integration")
    print("=" * 60)
    
    # Create tool manager
    tool_manager = ToolManager()
    
    # Load configuration
    print("\n1. Loading MCP Configuration...")
    servers = tool_manager.load_mcp_config("mcp_config.yaml")
    
    print(f"\nLoaded {len(servers)} servers:")
    for server in servers:
        print(f"  - {server}")
    
    # Test workbench creation
    print("\n2. Creating McpWorkbenches...")
    try:
        workbenches = await tool_manager.load_mcp_workbenches()
        
        print(f"\nWorkbenches created: {len(workbenches)}")
        for server_name, workbench in workbenches.items():
            print(f"  - {server_name}: {type(workbench).__name__}")
            
            # Test listing tools from workbench
            try:
                tools = await workbench.list_tools()
                print(f"    Tools available: {len(tools)}")
                if tools:
                    for tool in tools[:3]:  # Show first 3 tools
                        tool_name = tool.get('name', 'unknown')
                        tool_desc = tool.get('description', 'No description')[:50] + '...'
                        print(f"      - {tool_name}: {tool_desc}")
                    if len(tools) > 3:
                        print(f"      ... and {len(tools) - 3} more tools")
            except Exception as e:
                print(f"    Error listing tools: {e}")
        
        # Test individual workbench access
        print("\n3. Testing Workbench Access...")
        for server_name in workbenches.keys():
            wb = tool_manager.get_workbench(server_name)
            if wb:
                print(f"  ✓ Can access workbench for {server_name}")
            else:
                print(f"  ✗ Cannot access workbench for {server_name}")
        
        # Test tool calling (if tools are available)
        print("\n4. Testing Tool Calls...")
        for server_name, workbench in workbenches.items():
            try:
                tools = await workbench.list_tools()
                if tools:
                    # Try to call the first tool with minimal args (if safe)
                    first_tool = tools[0]
                    tool_name = first_tool.get('name')
                    print(f"  Testing tool '{tool_name}' from {server_name}...")
                    
                    # Only test safe tools or tools we know
                    if tool_name and ('list' in tool_name.lower() or 'get' in tool_name.lower()):
                        try:
                            # Call with empty args for list/get type tools
                            result = await workbench.call_tool(tool_name, {})
                            print(f"    ✓ Tool call successful: {str(result)[:100]}...")
                        except Exception as e:
                            print(f"    ⚠ Tool call failed (expected): {e}")
                    else:
                        print(f"    ⚠ Skipping tool call for safety: {tool_name}")
                else:
                    print(f"  No tools available for {server_name}")
            except Exception as e:
                print(f"  Error testing tools for {server_name}: {e}")
        
        # Clean up
        print("\n5. Cleaning up...")
        await tool_manager.close_workbenches()
        print("  ✓ All workbenches closed")
        
    except Exception as e:
        print(f"Error in workbench integration test: {e}")
        import traceback
        traceback.print_exc()
    
    print("\n" + "=" * 60)
    print("Workbench Integration Test Complete")
    print("=" * 60)

async def test_comparison():
    """Compare old direct loading vs new workbench approach"""
    print("\n" + "=" * 60)
    print("Comparing Direct Loading vs Workbench Approach")
    print("=" * 60)
    
    tool_manager = ToolManager()
    tool_manager.load_mcp_config("mcp_config.yaml")
    
    print("\n1. Testing Direct Tool Loading (Old Approach)...")
    try:
        direct_tools = await tool_manager.load_mcp_tools()
        print(f"  Direct loading result: {len(direct_tools)} tools loaded")
    except Exception as e:
        print(f"  Direct loading failed: {e}")
    
    print("\n2. Testing Workbench Approach (New Approach)...")
    try:
        workbenches = await tool_manager.load_mcp_workbenches()
        total_tools = 0
        for server_name, workbench in workbenches.items():
            try:
                tools = await workbench.list_tools()
                total_tools += len(tools)
            except:
                pass
        print(f"  Workbench approach result: {len(workbenches)} workbenches, {total_tools} total tools")
        
        # Clean up
        await tool_manager.close_workbenches()
        
    except Exception as e:
        print(f"  Workbench approach failed: {e}")
    
    print("\n" + "=" * 60)
    print("Comparison Complete")
    print("=" * 60)

if __name__ == "__main__":
    # Set environment variables
    os.environ.setdefault("CONTEXT7_API_KEY", "ctx7sk-9dfa3d11-51ca-4ea9-a7fc-0150630879ee")
    
    print("McpWorkbench Integration Test Suite")
    print("===================================")
    
    if len(sys.argv) > 1 and sys.argv[1] == "--workbench-only":
        print("\nTesting workbench integration only...")
        asyncio.run(test_workbench_integration())
    elif len(sys.argv) > 1 and sys.argv[1] == "--compare":
        print("\nComparing both approaches...")
        asyncio.run(test_comparison())
    else:
        print("\nRunning full workbench integration test...")
        print("Use --workbench-only for workbench test only")
        print("Use --compare to compare both approaches")
        print("\n" + "=" * 60)
        asyncio.run(test_workbench_integration())
