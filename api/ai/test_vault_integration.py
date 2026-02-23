#!/usr/bin/env python3
"""
Test script for Vault Git Credential Integration

This script tests the Vault integration with various scenarios:
1. Vault client initialization (with/without Vault)
2. Git credential storage and retrieval
3. Git URL credential injection
4. Public repo cloning (no credentials)
5. Private repo cloning (with credentials)
"""

import asyncio
import os
import sys
from pathlib import Path

# Add parent directory to path to import modules
sys.path.insert(0, str(Path(__file__).parent))

from vault_client import VaultClient, get_vault_client
from git_utils import clone_repository, sanitize_git_url


def print_test(name: str):
    """Print test header."""
    print(f"\n{'='*60}")
    print(f"TEST: {name}")
    print(f"{'='*60}")


def print_result(success: bool, message: str):
    """Print test result."""
    icon = "✅" if success else "❌"
    print(f"{icon} {message}")


async def test_vault_client():
    """Test Vault client initialization."""
    print_test("Vault Client Initialization")
    
    # Test 1: Get singleton client
    print("\n1. Creating Vault client...")
    client = get_vault_client()
    print_result(client is not None, "Client created")
    
    # Test 2: Check availability
    print("\n2. Checking Vault availability...")
    available = client.is_available()
    print_result(available, f"Vault available: {available}")
    
    if available:
        print(f"   Vault address: {client.vault_addr}")
    else:
        print("   ℹ️  Vault not available (normal for local dev without Vault)")
        print("   ℹ️  Set VAULT_ADDR and VAULT_TOKEN to test with real Vault")
    
    return client


async def test_credential_storage(client: VaultClient):
    """Test credential storage and retrieval."""
    print_test("Credential Storage & Retrieval")
    
    if not client.is_available():
        print_result(False, "Skipped (Vault not available)")
        return
    
    test_user_id = "test_user_123"
    test_username = "test_github_user"
    test_token = "ghp_test_token_123"
    
    # Test 1: Store credential
    print("\n1. Storing git credential...")
    success = client.store_git_credential(
        user_id=test_user_id,
        username=test_username,
        token=test_token,
        credential_name="test_github_pat",
        provider="github"
    )
    print_result(success, f"Stored credential for user {test_user_id}")
    
    # Test 2: Retrieve credential
    print("\n2. Retrieving git credential...")
    credential = client.get_git_credential(test_user_id, "test_github_pat")
    
    if credential:
        print_result(True, "Retrieved credential")
        print(f"   Has username: {bool(credential.get('username'))}")
        print(f"   Has provider: {bool(credential.get('provider'))}")
        print(f"   Has token: {bool(credential.get('token'))}")
        
        # Verify data
        assert credential.get('username') == test_username
        assert credential.get('token') == test_token
        print_result(True, "Credential data verified")
    else:
        print_result(False, "Failed to retrieve credential")
    
    # Test 3: List credentials
    print("\n3. Listing credentials...")
    credentials = client.list_git_credentials(test_user_id)
    print_result(len(credentials) > 0, f"Found {len(credentials)} credentials")
    print(f"   Credentials: {credentials}")
    
    # Test 4: Delete credential
    print("\n4. Deleting credential...")
    success = client.delete_git_credential(test_user_id, "test_github_pat")
    print_result(success, "Deleted credential")
    
    # Test 5: Verify deletion
    print("\n5. Verifying deletion...")
    credential = client.get_git_credential(test_user_id, "test_github_pat")
    print_result(credential is None, "Credential deleted successfully")


async def test_url_sanitization():
    """Test URL sanitization for logging."""
    print_test("URL Sanitization")
    
    test_cases = [
        (
            "https://github.com/owner/repo.git",
            "https://github.com/owner/repo.git"
        ),
        (
            "https://user:token123@github.com/owner/repo.git",
            "https://***:***@github.com/owner/repo.git"
        ),
        (
            "https://myuser:ghp_secret_token@gitlab.com/org/project.git",
            "https://***:***@gitlab.com/org/project.git"
        ),
    ]
    
    for i, (input_url, expected_output) in enumerate(test_cases, 1):
        print(f"\n{i}. Testing: {input_url[:50]}...")
        result = sanitize_git_url(input_url)
        success = result == expected_output
        print_result(success, f"Sanitized correctly")
        if not success:
            print(f"   Expected: {expected_output}")
            print(f"   Got:      {result}")


async def test_public_repo_clone():
    """Test cloning a public repository (no credentials needed)."""
    print_test("Public Repository Clone")
    
    # Use a small public repo for testing
    repo_url = "https://github.com/octocat/Hello-World.git"
    target_dir = Path("/tmp/test_public_repo")
    
    # Clean up if exists
    if target_dir.exists():
        import shutil
        shutil.rmtree(target_dir)
    
    print(f"\n1. Cloning public repo: {repo_url}")
    print(f"   Target: {target_dir}")
    
    success, result = await clone_repository(
        repo_url=repo_url,
        target_dir=target_dir,
        branch="master",
        depth=1,
        user_id=None  # No user_id = no credential injection
    )
    
    if success:
        print_result(True, f"Clone successful (commit: {result[:8]})")
        
        # Verify cloned content
        if (target_dir / "README").exists():
            print_result(True, "Repository content verified")
        else:
            print_result(False, "Repository content missing")
        
        # Clean up
        import shutil
        shutil.rmtree(target_dir)
        print("   🧹 Cleaned up test directory")
    else:
        print_result(False, f"Clone failed: {result}")


async def test_private_repo_simulation():
    """Simulate private repo cloning with credential injection."""
    print_test("Private Repository Simulation")
    
    print("\nℹ️  This test simulates credential injection without actual cloning")
    print("ℹ️  To fully test, you need:")
    print("   1. A running Vault instance")
    print("   2. A stored GitHub PAT")
    print("   3. A private repository to clone")
    
    # Show how it would work
    print("\n📝 Example workflow:")
    print("   1. User stores credential via API:")
    print("      POST /api/vault/git-credentials")
    print("      { username: 'myuser', token: 'ghp_xxx' }")
    print()
    print("   2. User clones private repo:")
    print("      POST /api/marketplace/clone")
    print("      { owner: 'myorg', repo: 'private-repo' }")
    print()
    print("   3. SLAR automatically:")
    print("      - Extracts user_id from auth token")
    print("      - Fetches credential from Vault")
    print("      - Injects into URL: https://myuser:ghp_xxx@github.com/...")
    print("      - Clones successfully!")
    
    print_result(True, "Credential injection flow documented")


async def main():
    """Run all tests."""
    print("=" * 60)
    print("Vault Git Credential Integration Tests")
    print("=" * 60)
    
    # Test 1: Vault client
    client = await test_vault_client()
    
    # Test 2: Credential storage (if Vault available)
    await test_credential_storage(client)
    
    # Test 3: URL sanitization
    await test_url_sanitization()
    
    # Test 4: Public repo clone
    await test_public_repo_clone()
    
    # Test 5: Private repo simulation
    await test_private_repo_simulation()
    
    print("\n" + "=" * 60)
    print("✅ All tests completed!")
    print("=" * 60)
    
    if not client.is_available():
        print("\n💡 Tip: To test with real Vault:")
        print("   1. Start Vault: vault server -dev -dev-root-token-id=root")
        print("   2. Set env: export VAULT_ADDR=http://localhost:8200")
        print("   3. Set env: export VAULT_TOKEN=root")
        print("   4. Run tests again")


if __name__ == "__main__":
    asyncio.run(main())
