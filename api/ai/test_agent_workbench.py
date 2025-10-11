#!/usr/bin/env python3
"""
Test script to verify agent works correctly with workbench pattern
"""

import asyncio
import os
from agent import SLARAgent

async def test_agent_with_workbench():
    """Test agent creation and workbench integration"""
    print("=" * 60)
    print("Testing Agent with Workbench Pattern")
    print("=" * 60)
    
    # Set environment variables
    os.environ.setdefault("CONTEXT7_API_KEY", "ctx7sk-9dfa3d11-51ca-4ea9-a7fc-0150630879ee")
    
    try:
        # Create SLAR agent
        print("\n1. Creating SLAR Agent...")
        slar_agent = SLARAgent()
        
        # Initialize MCP workbenches
        print("\n2. Initializing MCP workbenches...")
        workbenches = await slar_agent.initialize_mcp_tools("mcp_config.yaml")
        
        print(f"Workbenches initialized: {len(workbenches) if workbenches else 0}")
        if workbenches:
            for name, workbench in workbenches.items():
                print(f"  - {name}: {type(workbench).__name__}")
        
        # Test SRE agent creation
        print("\n3. Creating SRE Agent...")
        if not os.getenv("OPENAI_API_KEY"):
            print("  Skipping SRE agent creation (no OPENAI_API_KEY)")
        else:
            try:
                sre_agent = await slar_agent.create_sre_agent()
                print(f"  ✓ SRE Agent created: {sre_agent.name}")
                print(f"  Workbenches attached: {len(sre_agent._workbench) if hasattr(sre_agent, '_workbench') and sre_agent._workbench else 0}")
            except Exception as e:
                print(f"  ✗ SRE Agent creation failed: {e}")
        
        # Test K8s agent creation
        print("\n4. Creating K8s Agent...")
        if not os.getenv("OPENAI_API_KEY"):
            print("  Skipping K8s agent creation (no OPENAI_API_KEY)")
        else:
            try:
                k8s_agent = await slar_agent.create_k8s_agent()
                print(f"  ✓ K8s Agent created: {k8s_agent.name}")
                print(f"  Workbenches attached: {len(k8s_agent._workbench) if hasattr(k8s_agent, '_workbench') and k8s_agent._workbench else 0}")
            except Exception as e:
                print(f"  ✗ K8s Agent creation failed: {e}")
        
        # Test workbench access
        print("\n5. Testing workbench access...")
        for name, workbench in (workbenches or {}).items():
            try:
                tools = await workbench.list_tools()
                print(f"  {name}: {len(tools)} tools available")
                
                # Show first few tools
                for tool in tools[:2]:
                    tool_name = tool.get('name', 'unknown')
                    print(f"    - {tool_name}")
                
                if len(tools) > 2:
                    print(f"    ... and {len(tools) - 2} more")
                    
            except Exception as e:
                print(f"  {name}: Error listing tools - {e}")
        
        # Cleanup
        print("\n6. Cleanup...")
        await slar_agent.tool_manager.close_workbenches()
        print("  ✓ Workbenches closed")
        
    except Exception as e:
        print(f"Error in test: {e}")
        import traceback
        traceback.print_exc()
    
    print("\n" + "=" * 60)
    print("Agent Workbench Test Complete")
    print("=" * 60)

async def test_workbench_vs_tools():
    """Compare workbench approach vs old tools approach"""
    print("\n" + "=" * 60)
    print("Comparing Workbench vs Tools Approach")
    print("=" * 60)
    
    os.environ.setdefault("CONTEXT7_API_KEY", "ctx7sk-9dfa3d11-51ca-4ea9-a7fc-0150630879ee")
    
    slar_agent = SLARAgent()
    
    print("\n1. Testing Workbench Approach (New)...")
    try:
        workbenches = await slar_agent.initialize_mcp_tools("mcp_config.yaml")
        print(f"  Workbenches loaded: {len(workbenches) if workbenches else 0}")
        
        # Test agent creation with workbenches
        if os.getenv("OPENAI_API_KEY") and workbenches:
            try:
                agent = await slar_agent.create_sre_agent()
                print("  ✓ Agent created successfully with workbenches")
                
                # Check if agent has workbenches
                if hasattr(agent, '_workbench') and agent._workbench:
                    print(f"  ✓ Agent has {len(agent._workbench)} workbenches attached")
                else:
                    print("  ⚠ Agent has no workbenches attached")
                    
            except Exception as e:
                print(f"  ✗ Agent creation with workbenches failed: {e}")
        
        await slar_agent.tool_manager.close_workbenches()
        
    except Exception as e:
        print(f"  Workbench approach failed: {e}")
    
    print("\n2. Testing Direct Tools Approach (Old)...")
    try:
        # Reset agent for clean test
        slar_agent = SLARAgent()
        slar_agent.tool_manager.load_mcp_config("mcp_config.yaml")
        
        # Use old direct tools loading
        tools = await slar_agent.tool_manager.load_mcp_tools()
        print(f"  Direct tools loaded: {len(tools) if tools else 0}")
        
        if tools:
            print(f"  Tool types: {[type(tool).__name__ for tool in tools[:3]]}")
        
    except Exception as e:
        print(f"  Direct tools approach failed: {e}")
    
    print("\n" + "=" * 60)
    print("Comparison Complete")
    print("=" * 60)

if __name__ == "__main__":
    print("Agent Workbench Integration Test")
    print("================================")
    
    # Run tests
    asyncio.run(test_agent_with_workbench())
    asyncio.run(test_workbench_vs_tools())
