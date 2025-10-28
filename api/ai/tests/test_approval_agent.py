"""
Test script for AssistantAgent with tool approval functionality.

This script demonstrates different approval patterns:
1. Human-in-the-loop approval
2. Rule-based approval
3. Auto-approve and deny lists
4. LLM-based approval (if API key available)
"""

import asyncio
import os
import sys

# Add parent directory to path for imports
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from autogen_ext.models.openai import OpenAIChatCompletionClient

from core.sre_agent import (
    AssistantAgent,
    ToolApprovalRequest,
    ToolApprovalResponse,
    create_human_approval_func,
    create_rule_based_approval_func,
    create_llm_approval_func,
)


# Define some example tools for testing
def get_server_status(server_name: str) -> str:
    """Get the current status of a server (read-only operation)."""
    return f"Server '{server_name}' is running. CPU: 45%, Memory: 60%, Uptime: 15 days"


def list_services() -> str:
    """List all running services (read-only operation)."""
    return "Running services: nginx, postgresql, redis, rabbitmq"


def restart_service(service_name: str) -> str:
    """Restart a service (potentially disruptive operation)."""
    return f"Service '{service_name}' has been restarted successfully"


def delete_logs(older_than_days: int) -> str:
    """Delete old log files (destructive operation)."""
    return f"Deleted log files older than {older_than_days} days"


def deploy_to_production(version: str) -> str:
    """Deploy a new version to production (critical operation)."""
    return f"Deployed version {version} to production environment"


def check_disk_space() -> str:
    """Check available disk space (read-only operation)."""
    return "Disk usage: /dev/sda1 75% used, 250GB available"


async def test_human_approval():
    """Test with human-in-the-loop approval."""
    print("\n" + "=" * 80)
    print("TEST 1: Human-in-the-loop Approval")
    print("=" * 80)
    print("This test will ask you to approve each tool call.")
    print("Tools available: get_server_status, restart_service, delete_logs")
    print()

    # Create model client
    model_client = OpenAIChatCompletionClient(
        model="gpt-4o-mini",
        api_key=os.getenv("OPENAI_API_KEY", "sk-test"),
    )

    # Create agent with human approval
    agent = AssistantAgent(
        name="sre_assistant",
        model_client=model_client,
        tools=[get_server_status, restart_service, delete_logs],
        approval_func=create_human_approval_func(verbose=True),
        system_message="You are an SRE assistant. Use the available tools to help with server management.",
    )

    # Test with a task that requires tool use
    task = "Check the status of server 'web-01'"

    try:
        result = await agent.run(task=task)
        print("\n" + "-" * 80)
        print("RESULT:")
        print("-" * 80)
        print(f"Final response: {result.messages[-1].content if result.messages else 'No response'}")
    except Exception as e:
        print(f"\nError: {e}")


async def test_rule_based_approval():
    """Test with rule-based approval."""
    print("\n" + "=" * 80)
    print("TEST 2: Rule-Based Approval")
    print("=" * 80)
    print("Rules:")
    print("  ✅ Auto-approve: Tools starting with 'get_', 'list_', 'check_'")
    print("  ❌ Auto-deny: Tools containing 'delete', 'destroy', 'terminate'")
    print("  ❌ Auto-deny: Operations on 'production' environment")
    print()

    model_client = OpenAIChatCompletionClient(
        model="gpt-4o-mini",
        api_key=os.getenv("OPENAI_API_KEY", "sk-test"),
    )

    # Create agent with rule-based approval
    agent = AssistantAgent(
        name="sre_assistant",
        model_client=model_client,
        tools=[
            get_server_status,
            list_services,
            check_disk_space,
            restart_service,
            delete_logs,
            deploy_to_production,
        ],
        approval_func=create_rule_based_approval_func(
            allow_read_only=True,
            deny_destructive=True,
            deny_production=True,
        ),
        system_message="You are an SRE assistant. Use the available tools to help with server management.",
    )

    # Test multiple scenarios
    test_cases = [
        ("Check the status of server 'web-01'", "Should auto-approve (read-only)"),
        ("List all running services", "Should auto-approve (read-only)"),
        ("Check disk space", "Should auto-approve (read-only)"),
        ("Delete logs older than 30 days", "Should auto-deny (destructive)"),
        ("Deploy version 2.0 to production", "Should auto-deny (production)"),
    ]

    for task, expected in test_cases:
        print(f"\n{'─' * 80}")
        print(f"Task: {task}")
        print(f"Expected: {expected}")
        print(f"{'─' * 80}")

        try:
            result = await agent.run(task=task)
            final_message = result.messages[-1].content if result.messages else "No response"
            print(f"Result: {final_message[:200]}...")
        except Exception as e:
            print(f"Error: {e}")


async def test_allowlist_denylist():
    """Test with allowlist and denylist."""
    print("\n" + "=" * 80)
    print("TEST 3: Allowlist & Denylist")
    print("=" * 80)
    print("Configuration:")
    print("  ✅ Auto-approve: ['get_server_status', 'check_disk_space']")
    print("  ❌ Always deny: ['delete_logs', 'deploy_to_production']")
    print("  ❓ Other tools: Require approval")
    print()

    model_client = OpenAIChatCompletionClient(
        model="gpt-4o-mini",
        api_key=os.getenv("OPENAI_API_KEY", "sk-test"),
    )

    # Create a simple approval function that approves everything
    def always_approve(request: ToolApprovalRequest) -> ToolApprovalResponse:
        return ToolApprovalResponse(approved=True, reason="Auto-approved for testing")

    agent = AssistantAgent(
        name="sre_assistant",
        model_client=model_client,
        tools=[
            get_server_status,
            check_disk_space,
            restart_service,
            delete_logs,
            deploy_to_production,
        ],
        approval_func=always_approve,
        auto_approve_tools=["get_server_status", "check_disk_space"],
        always_deny_tools=["delete_logs", "deploy_to_production"],
        system_message="You are an SRE assistant. Use the available tools to help with server management.",
    )

    test_cases = [
        ("Check the status of server 'web-01'", "Should skip approval (allowlist)"),
        ("Check disk space", "Should skip approval (allowlist)"),
        ("Restart the nginx service", "Should ask approval function"),
        ("Delete logs older than 30 days", "Should be denied (denylist)"),
        ("Deploy version 2.0 to production", "Should be denied (denylist)"),
    ]

    for task, expected in test_cases:
        print(f"\n{'─' * 80}")
        print(f"Task: {task}")
        print(f"Expected: {expected}")
        print(f"{'─' * 80}")

        try:
            result = await agent.run(task=task)
            final_message = result.messages[-1].content if result.messages else "No response"
            print(f"Result: {final_message[:200]}...")
        except Exception as e:
            print(f"Error: {e}")


async def test_llm_approval():
    """Test with LLM-based approval."""
    print("\n" + "=" * 80)
    print("TEST 4: LLM-Based Approval")
    print("=" * 80)
    print("Using GPT-4o to review and approve tool calls based on safety analysis.")
    print()

    # Check if API key is available
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key or api_key == "sk-test":
        print("⚠️  SKIPPING: OpenAI API key not found. Set OPENAI_API_KEY environment variable.")
        return

    model_client = OpenAIChatCompletionClient(model="gpt-4o-mini", api_key=api_key)
    safety_client = OpenAIChatCompletionClient(model="gpt-4o", api_key=api_key)

    agent = AssistantAgent(
        name="sre_assistant",
        model_client=model_client,
        tools=[get_server_status, restart_service, delete_logs, deploy_to_production],
        approval_func=create_llm_approval_func(safety_client),
        system_message="You are an SRE assistant. Use the available tools to help with server management.",
    )

    test_cases = [
        ("Check the status of server 'web-01'", "LLM should approve (safe read)"),
        ("Restart the nginx service", "LLM should evaluate risk"),
        ("Delete logs older than 30 days", "LLM should evaluate risk"),
    ]

    for task, expected in test_cases:
        print(f"\n{'─' * 80}")
        print(f"Task: {task}")
        print(f"Expected: {expected}")
        print(f"{'─' * 80}")

        try:
            result = await agent.run(task=task)
            final_message = result.messages[-1].content if result.messages else "No response"
            print(f"Result: {final_message[:200]}...")
        except Exception as e:
            print(f"Error: {e}")


async def test_custom_approval():
    """Test with custom approval logic."""
    print("\n" + "=" * 80)
    print("TEST 5: Custom Approval Logic")
    print("=" * 80)
    print("Custom rule: Only allow operations during business hours (9 AM - 5 PM)")
    print()

    from datetime import datetime

    def business_hours_approval(request: ToolApprovalRequest) -> ToolApprovalResponse:
        """Custom approval that only allows operations during business hours."""
        current_hour = datetime.now().hour

        # Allow read-only operations anytime
        if request.tool_name.startswith(("get_", "list_", "check_")):
            return ToolApprovalResponse(approved=True, reason="Read-only operation allowed anytime")

        # Check business hours for other operations
        if 9 <= current_hour < 17:
            return ToolApprovalResponse(approved=True, reason="Approved during business hours")
        else:
            return ToolApprovalResponse(
                approved=False, reason=f"Operation not allowed outside business hours (current: {current_hour}:00)"
            )

    model_client = OpenAIChatCompletionClient(
        model="gpt-4o-mini",
        api_key=os.getenv("OPENAI_API_KEY", "sk-test"),
    )

    agent = AssistantAgent(
        name="sre_assistant",
        model_client=model_client,
        tools=[get_server_status, restart_service, deploy_to_production],
        approval_func=business_hours_approval,
        system_message="You are an SRE assistant. Use the available tools to help with server management.",
    )

    current_hour = datetime.now().hour
    print(f"Current time: {current_hour}:00")
    print(f"Business hours: {'YES ✅' if 9 <= current_hour < 17 else 'NO ❌'}")

    test_cases = [
        ("Check the status of server 'web-01'", "Should always approve"),
        ("Restart the nginx service", "Depends on current time"),
    ]

    for task, expected in test_cases:
        print(f"\n{'─' * 80}")
        print(f"Task: {task}")
        print(f"Expected: {expected}")
        print(f"{'─' * 80}")

        try:
            result = await agent.run(task=task)
            final_message = result.messages[-1].content if result.messages else "No response"
            print(f"Result: {final_message[:200]}...")
        except Exception as e:
            print(f"Error: {e}")


async def main():
    """Run all tests."""
    print("\n" + "=" * 80)
    print(" Tool Approval System - Test Suite")
    print("=" * 80)
    print()
    print("This script demonstrates various approval patterns for tool execution.")
    print()

    # Check if OpenAI API key is set
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("⚠️  WARNING: OPENAI_API_KEY not set. Using dummy key for demonstration.")
        print("   Some tests may fail. Set environment variable for full testing.")
        os.environ["OPENAI_API_KEY"] = "sk-test"

    # Run tests
    tests = [
        ("Rule-Based Approval", test_rule_based_approval),
        ("Allowlist & Denylist", test_allowlist_denylist),
        ("Custom Approval Logic", test_custom_approval),
        ("LLM-Based Approval", test_llm_approval),
        ("Human Approval", test_human_approval),  # Last because it requires interaction
    ]

    for test_name, test_func in tests:
        try:
            print("\n")
            await test_func()
        except KeyboardInterrupt:
            print(f"\n\n⚠️  Test '{test_name}' interrupted by user")
            break
        except Exception as e:
            print(f"\n\n❌ Test '{test_name}' failed with error: {e}")
            import traceback

            traceback.print_exc()

    print("\n" + "=" * 80)
    print(" Test Suite Complete")
    print("=" * 80)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n⚠️  Test suite interrupted by user")
    except Exception as e:
        print(f"\n\n❌ Test suite failed: {e}")
        import traceback

        traceback.print_exc()
