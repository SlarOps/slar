"""
Test script for SLAR Incident Management Tools

This script tests the incident tools by directly invoking them
without going through the full Claude Agent SDK.
"""

import asyncio
import os
from datetime import datetime, timedelta, timezone
from incident_tools import (
    _get_incidents_by_time_impl,
    _get_incident_by_id_impl,
    _get_incident_stats_impl
)


async def test_get_incidents_by_time():
    """Test fetching incidents by time range"""
    print("\n" + "="*80)
    print("TEST 1: Get incidents by time range")
    print("="*80)

    # Calculate time range (last 24 hours)
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(days=1)

    args = {
        "start_time": start_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end_time": end_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "all",
        "limit": 10
    }

    print(f"\nTest Parameters:")
    print(f"  Start Time: {args['start_time']}")
    print(f"  End Time: {args['end_time']}")
    print(f"  Status: {args['status']}")
    print(f"  Limit: {args['limit']}")

    result = await _get_incidents_by_time_impl(args)

    print(f"\nResult:")
    if result.get("isError"):
        print("  ❌ Error occurred")
    else:
        print("  ✅ Success")

    for content in result.get("content", []):
        print(f"\n{content.get('text', '')}")


async def test_get_incidents_with_status():
    """Test fetching incidents filtered by status"""
    print("\n" + "="*80)
    print("TEST 2: Get triggered incidents only")
    print("="*80)

    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(days=7)

    args = {
        "start_time": start_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end_time": end_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "triggered",
        "limit": 5
    }

    print(f"\nTest Parameters:")
    print(f"  Status Filter: {args['status']}")
    print(f"  Time Range: Last 7 days")

    result = await _get_incidents_by_time_impl(args)

    for content in result.get("content", []):
        print(f"\n{content.get('text', '')}")


async def test_get_incident_by_id():
    """Test fetching a specific incident by ID"""
    print("\n" + "="*80)
    print("TEST 3: Get incident by ID")
    print("="*80)

    # First, get some incidents to find a valid ID
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(days=30)

    list_args = {
        "start_time": start_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end_time": end_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "all",
        "limit": 1
    }

    print("\n  First, fetching a recent incident to get a valid ID...")
    list_result = await _get_incidents_by_time_impl(list_args)

    # Try to extract an incident ID from the response
    # In a real scenario, you would parse the response properly
    print("\n  Note: To test this properly, replace 'test-incident-id' with a real ID")
    print("  from the incidents listed above.")

    args = {
        "incident_id": "0599df50-b62d-4d89-86e0-053ca475382b"  # Replace with actual ID
    }

    result = await _get_incident_by_id_impl(args)

    for content in result.get("content", []):
        print(f"\n{content.get('text', '')}")


async def test_get_incident_stats():
    """Test fetching incident statistics"""
    print("\n" + "="*80)
    print("TEST 4: Get incident statistics")
    print("="*80)

    test_ranges = ["24h", "7d", "30d"]

    for time_range in test_ranges:
        print(f"\n--- Stats for {time_range} ---")

        args = {
            "time_range": time_range
        }

        result = await _get_incident_stats_impl(args)

        for content in result.get("content", []):
            print(content.get('text', ''))


async def test_invalid_inputs():
    """Test error handling with invalid inputs"""
    print("\n" + "="*80)
    print("TEST 5: Error handling with invalid inputs")
    print("="*80)

    # Test 1: Invalid time format
    print("\n--- Test 5.1: Invalid time format ---")
    args = {
        "start_time": "invalid-time",
        "end_time": "also-invalid",
        "status": "all",
        "limit": 10
    }

    result = await _get_incidents_by_time_impl(args)
    print(f"Expected error: {result.get('content', [{}])[0].get('text', '')}")

    # Test 2: Invalid limit
    print("\n--- Test 5.2: Invalid limit ---")
    args = {
        "start_time": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end_time": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "all",
        "limit": 99999  # Exceeds max
    }

    result = await _get_incidents_by_time_impl(args)
    print(f"Expected error: {result.get('content', [{}])[0].get('text', '')}")

    # Test 3: Invalid time range for stats
    print("\n--- Test 5.3: Invalid time range for stats ---")
    args = {
        "time_range": "invalid"
    }

    result = await _get_incident_stats_impl(args)
    print(f"Expected error: {result.get('content', [{}])[0].get('text', '')}")


async def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("SLAR Incident Tools Test Suite")
    print("="*80)

    # Check environment variables
    api_url = os.getenv("SLAR_API_URL", "http://localhost:8080")
    api_token = os.getenv("SLAR_API_TOKEN", "")

    print(f"\nConfiguration:")
    print(f"  API URL: {api_url}")
    print(f"  API Token: {'✅ Set' if api_token else '❌ Not set (will fail authentication)'}")

    if not api_token:
        print("\n⚠️  Warning: SLAR_API_TOKEN not set!")
        print("   Set it with: export SLAR_API_TOKEN='your-token'")
        print("   Tests will run but API calls will fail with 401 Unauthorized\n")

    # Run tests
    try:
        await test_get_incidents_by_time()
        await test_get_incidents_with_status()
        await test_get_incident_by_id()
        await test_get_incident_stats()
        await test_invalid_inputs()

        print("\n" + "="*80)
        print("✅ All tests completed")
        print("="*80)

    except Exception as e:
        print(f"\n❌ Test suite failed with error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    # Run the async test suite
    asyncio.run(main())
