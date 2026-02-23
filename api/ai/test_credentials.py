#!/usr/bin/env python3
"""
Test script for generic credential management system.

Tests the new generic credential types, validation, and API.
"""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from credential_types import (
    CredentialType,
    validate_credential_data,
    CREDENTIAL_TYPE_METADATA,
    get_credential_schema
)
from vault_client import get_vault_client
import vault_client


def print_test(name: str):
    """Print test header."""
    print(f"\n{'='*70}")
    print(f"TEST: {name}")
    print(f"{'='*70}")


def print_result(success: bool, message: str):
    """Print test result."""
    icon = "✅" if success else "❌"
    print(f"{icon} {message}")


def test_credential_types():
    """Test credential type definitions."""
    print_test("Credential Type Definitions")
    
    # Test 1: Count types
    print("\n1. Credential types defined:")
    print(f"   Total types: {len(CredentialType)}")
    
    categories = {}
    for cred_type in CredentialType:
        metadata = CREDENTIAL_TYPE_METADATA.get(cred_type, {})
        category = metadata.get("category", "unknown")
        if category not in categories:
            categories[category] = []
        categories[category].append(cred_type.value)
    
    for category, types in categories.items():
        print(f"   {category.capitalize()}: {len(types)} types")
        for t in types:
            print(f"     - {t}")
    
    print_result(len(CredentialType) == 15, f"All 15 credential types defined")
    
    # Test 2: Metadata completeness
    print("\n2. Checking metadata completeness:")
    missing_metadata = []
    for cred_type in CredentialType:
        metadata = CREDENTIAL_TYPE_METADATA.get(cred_type)
        if not metadata:
            missing_metadata.append(cred_type.value)
    
    if missing_metadata:
        print_result(False, f"Missing metadata for: {missing_metadata}")
    else:
        print_result(True, "All types have metadata")
    
    # Test 3: Schema registration
    print("\n3. Checking schema registration:")
    missing_schemas = []
    for cred_type in CredentialType:
        schema = get_credential_schema(cred_type)
        if not schema:
            missing_schemas.append(cred_type.value)
    
    if missing_schemas:
        print_result(False, f"Missing schemas for: {missing_schemas}")
    else:
        print_result(True, "All types have Pydantic schemas")


def test_validation():
    """Test credential validation."""
    print_test("Credential Validation")
    
    # Test 1: Valid GitHub PAT
    print("\n1. Testing valid GitHub PAT:")
    try:
        validated = validate_credential_data(
            CredentialType.GITHUB_PAT,
            {"username": "octocat", "token": "ghp_test123"}
        )
        print_result(True, "GitHub PAT validation passed")
        print(f"   Username: {validated.username}")
        print(f"   Has token: {bool(validated.token)}")
    except Exception as e:
        print_result(False, f"GitHub PAT validation failed: {e}")
    
    # Test 2: Invalid GitHub PAT (missing fields)
    print("\n2. Testing invalid GitHub PAT (missing token):")
    try:
        validate_credential_data(
            CredentialType.GITHUB_PAT,
            {"username": "octocat"}
        )
        print_result(False, "Should have raised validation error")
    except Exception as e:
        print_result(True, f"Correctly rejected invalid data: {type(e).__name__}")
    
    # Test 3: Valid Postgres connection
    print("\n3. Testing valid Postgres connection:")
    try:
        validated = validate_credential_data(
            CredentialType.POSTGRES_CONNECTION,
            {
                "host": "localhost",
                "port": 5432,
                "database": "testdb",
                "username": "user",
                "password": "pass"
            }
        )
        print_result(True, "Postgres validation passed")
        print(f"   Connection string: {validated.connection_string}")
    except Exception as e:
        print_result(False, f"Postgres validation failed: {e}")
    
    # Test 4: Valid Datadog API
    print("\n4. Testing valid Datadog API key:")
    try:
        validated = validate_credential_data(
            CredentialType.DATADOG_API_KEY,
            {
                "api_key": "test_api_key",
                "app_key": "test_app_key",
                "site": "datadoghq.com"
            }
        )
        print_result(True, "Datadog validation passed")
        print(f"   Site: {validated.site}")
    except Exception as e:
        print_result(False, f"Datadog validation failed: {e}")


async def test_vault_integration():
    """Test Vault integration with generic credentials."""
    print_test("Vault Integration - Generic Credentials")
    
    vault = get_vault_client()
    
    # Test 1: Check availability
    print("\n1. Checking Vault availability:")
    available = vault.is_available()
    print_result(available, f"Vault available: {available}")
    
    if not available:
        print("\nℹ️  Skipping Vault tests (Vault not available)")
        print("ℹ️  To test with Vault:")
        print("   1. Start Vault: vault server -dev -dev-root-token-id=root")
        print("   2. Set env: export VAULT_ADDR=http://localhost:8200")
        print("   3. Set env: export VAULT_TOKEN=root")
        return
    
    test_user_id = "test_user_generic"
    
    # Test 2: Store GitHub PAT
    print("\n2. Storing GitHub PAT credential:")
    success = vault_client.store_credential(
        user_id=test_user_id,
        credential_type="github_pat",
        credential_name="test_github",
        data={"username": "testuser", "token": "ghp_test123"},
        metadata={"description": "Test GitHub credential"}
    )
    print_result(success, "GitHub PAT stored")
    
    # Test 3: Store Postgres connection
    print("\n3. Storing Postgres connection:")
    success = vault_client.store_credential(
        user_id=test_user_id,
        credential_type="postgres_connection",
        credential_name="test_db",
        data={
            "host": "localhost",
            "port": 5432,
            "database": "testdb",
            "username": "user",
            "password": "pass"
        },
        metadata={"description": "Test database"}
    )
    print_result(success, "Postgres connection stored")
    
    # Test 4: List all credentials
    print("\n4. Listing all credentials:")
    credentials = vault_client.list_credentials(test_user_id)
    print_result(len(credentials) >= 2, f"Found {len(credentials)} credentials")
    for cred in credentials:
        print(f"   - {cred['type']}: {cred['name']}")
    
    # Test 5: List by type
    print("\n5. Listing GitHub credentials only:")
    github_creds = vault_client.list_credentials(test_user_id, "github_pat")
    print_result(len(github_creds) == 1, f"Found {len(github_creds)} GitHub credentials")
    
    # Test 6: Get specific credential
    print("\n6. Retrieving GitHub credential:")
    github_cred = vault_client.get_credential(test_user_id, "github_pat", "test_github")
    if github_cred:
        print_result(True, "Retrieved GitHub credential")
        print(f"   Has data: {bool(github_cred.get('data'))}")
        print(f"   Has metadata: {bool(github_cred.get('metadata'))}")
    else:
        print_result(False, "Failed to retrieve credential")
    
    # Test 7: Delete credentials
    print("\n7. Deleting test credentials:")
    success1 = vault_client.delete_credential(test_user_id, "github_pat", "test_github")
    success2 = vault_client.delete_credential(test_user_id, "postgres_connection", "test_db")
    print_result(success1 and success2, "Test credentials deleted")
    
    # Test 8: Verify deletion
    print("\n8. Verifying deletion:")
    credentials = vault_client.list_credentials(test_user_id)
    print_result(len(credentials) == 0, "All test credentials deleted")


async def main():
    """Run all tests."""
    print("=" * 70)
    print("Generic Credential Management System Tests")
    print("=" * 70)
    
    # Test 1: Type definitions
    test_credential_types()
    
    # Test 2: Validation
    test_validation()
    
    # Test 3: Vault integration
    await test_vault_integration()
    
    print("\n" + "=" * 70)
    print("✅ All tests completed!")
    print("=" * 70)
    
    print("\n💡 Next steps:")
    print("   1. Start the API: python claude_agent_api_v1.py")
    print("   2. Test API endpoints:")
    print("      GET  /api/credentials/types")
    print("      POST /api/credentials")
    print("      GET  /api/credentials")
    print("   3. Test UI at: http://localhost:8081/agent-config/credentials")


if __name__ == "__main__":
    asyncio.run(main())
