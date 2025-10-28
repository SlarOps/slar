"""
Simple quick test for tool approval functionality.
Run this to verify basic approval features are working.
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
    create_rule_based_approval_func,
)


# Simple test tools
def get_weather(city: str) -> str:
    """Get the weather for a city (safe read operation)."""
    return f"Weather in {city}: Sunny, 72°F"


def send_email(to: str, subject: str) -> str:
    """Send an email (requires approval)."""
    return f"Email sent to {to} with subject '{subject}'"


def delete_file(filename: str) -> str:
    """Delete a file (dangerous operation)."""
    return f"File '{filename}' has been deleted"


def check_status(service: str) -> str:
    """Check the status of a service (safe read operation)."""
    return f"Service '{service}' is running normally"


async def main():
    print("\n" + "=" * 80)
    print(" Quick Test: Tool Approval System")
    print("=" * 80)
    print()

    # Set up API key (use dummy if not available)
    api_key = os.getenv("OPENAI_API_KEY", "sk-test")

    print("Setting up agent with rule-based approval...")
    print("  ✅ Auto-approve: get_*, check_*, list_*")
    print("  ❌ Auto-deny: delete_*, destroy_*, terminate_*")
    print()

    # Create model client
    model_client = OpenAIChatCompletionClient(model="gpt-4o-mini", api_key=api_key)

    # Create agent with rule-based approval
    agent = AssistantAgent(
        name="assistant",
        model_client=model_client,
        tools=[get_weather, send_email, delete_file, check_status],
        approval_func=create_rule_based_approval_func(
            allow_read_only=True, deny_destructive=True, deny_production=False
        ),
        system_message="You are a helpful assistant. Use the available tools to help the user.",
    )

    # Test cases
    test_cases = [
        {
            "task": "What's the weather in San Francisco?",
            "expected": "Should auto-approve (get_ prefix)",
        },
        {
            "task": "Check the status of nginx service",
            "expected": "Should auto-approve (check_ prefix)",
        },
        {
            "task": "Delete the file test.txt",
            "expected": "Should auto-deny (delete_ prefix)",
        },
        {
            "task": "Send an email to admin@example.com about the meeting",
            "expected": "Should require approval (send_)",
        },
    ]

    for i, test in enumerate(test_cases, 1):
        print(f"\n{'─' * 80}")
        print(f"TEST {i}: {test['task']}")
        print(f"Expected: {test['expected']}")
        print(f"{'─' * 80}")

        try:
            result = await agent.run(task=test["task"])

            # Get the final message
            if result.messages:
                final_msg = result.messages[-1]
                print(f"✓ Result: {final_msg.content[:150]}...")

                # Check if tool was denied
                if "not approved" in str(final_msg.content).lower() or "denied" in str(final_msg.content).lower():
                    print("  → Tool execution was DENIED by approval function")
                elif "error" in str(final_msg.content).lower():
                    print("  → Tool execution encountered an error")
                else:
                    print("  → Tool execution was APPROVED and executed")
            else:
                print("  No messages returned")

        except Exception as e:
            print(f"✗ Error: {e}")

    print("\n" + "=" * 80)
    print(" Test Complete!")
    print("=" * 80)
    print()
    print("Summary:")
    print("  • Read-only operations (get_*, check_*) should be auto-approved")
    print("  • Destructive operations (delete_*) should be auto-denied")
    print("  • Other operations should go through approval logic")
    print()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n⚠️  Test interrupted by user")
    except Exception as e:
        print(f"\n\n❌ Test failed: {e}")
        import traceback

        traceback.print_exc()
