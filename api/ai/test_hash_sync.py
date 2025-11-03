"""
Test script for hash-based bucket synchronization.

This demonstrates how the hash-based sync works:
1. Calculate hash of bucket contents
2. Compare with local workspace hash
3. Sync only if changed
4. Save sync state for next check

Usage:
    python test_hash_sync.py
"""

import asyncio
import sys
from supabase_storage import (
    sync_all_from_bucket,
    should_sync_bucket,
    get_bucket_hash,
    get_local_workspace_hash,
    extract_user_id_from_token
)


async def test_hash_sync(auth_token: str):
    """
    Test hash-based sync functionality.

    Args:
        auth_token: Supabase JWT token
    """
    print("=" * 60)
    print("Hash-Based Bucket Sync Test")
    print("=" * 60)

    # Extract user ID
    user_id = extract_user_id_from_token(auth_token)
    if not user_id:
        print("❌ Failed to extract user_id from token")
        return

    print(f"\n👤 User ID: {user_id}")

    # Get bucket hash
    print("\n🔍 Calculating bucket hash...")
    bucket_hash = await get_bucket_hash(user_id)
    print(f"   Bucket hash: {bucket_hash[:16]}...")

    # Get local workspace hash
    print("\n📁 Calculating local workspace hash...")
    local_hash = await get_local_workspace_hash(user_id)
    print(f"   Local hash: {local_hash[:16] if local_hash else '(empty)'}...")

    # Check if sync needed
    print("\n🔍 Checking if sync needed...")
    needs_sync = await should_sync_bucket(user_id)
    print(f"   Needs sync: {'✅ YES' if needs_sync else '⏭️  NO'}")

    # Perform sync
    print("\n🔄 Running sync_all_from_bucket...")
    result = await sync_all_from_bucket(auth_token)

    print("\n" + "=" * 60)
    print("Sync Result:")
    print("=" * 60)
    print(f"Success: {result['success']}")
    print(f"Skipped: {result.get('skipped', False)}")
    print(f"Message: {result['message']}")

    if not result.get('skipped'):
        print(f"MCP Synced: {result.get('mcp_synced', False)}")
        print(f"Skills Synced: {result.get('skills_synced', 0)}")

    # Test second sync (should skip)
    print("\n" + "=" * 60)
    print("Testing Second Sync (should skip):")
    print("=" * 60)

    result2 = await sync_all_from_bucket(auth_token)
    print(f"Success: {result2['success']}")
    print(f"Skipped: {result2.get('skipped', False)}")
    print(f"Message: {result2['message']}")

    print("\n✅ Test completed!")


async def main():
    """Main test function."""
    # Check if auth token provided
    if len(sys.argv) < 2:
        print("Usage: python test_hash_sync.py <auth_token>")
        print("\nExample:")
        print("  python test_hash_sync.py 'Bearer eyJhb...'")
        sys.exit(1)

    auth_token = sys.argv[1]

    try:
        await test_hash_sync(auth_token)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
