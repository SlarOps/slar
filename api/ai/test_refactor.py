#!/usr/bin/env python3
"""
Simple test script to verify the refactored modules work correctly.
"""

import sys
import os

# Add current directory to path
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

def test_imports():
    """Test all module imports."""
    try:
        print("Testing imports...")
        
        # Test models
        from models import IncidentRunbookRequest, RunbookResult
        print("✅ Models imported successfully")
        
        # Test indexers
        from indexers import SimpleDocumentIndexer, GitHubDocumentIndexer
        print("✅ Indexers imported successfully")
        
        # Test session
        from session import AutoGenChatSession, SessionManager
        print("✅ Session management imported successfully")
        
        # Test utils
        from utils import generate_source_id, load_indexed_sources
        print("✅ Utils imported successfully")
        
        # Test routes
        from routes import health_router, sessions_router, runbook_router, websocket_router
        print("✅ Routes imported successfully")
        
        # Test main app
        from main import app, slar_agent_manager, session_manager
        print("✅ Main app imported successfully")
        
        print("\n🎉 All imports successful! Refactoring completed.")
        return True
        
    except Exception as e:
        print(f"❌ Import error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_imports()
    sys.exit(0 if success else 1)
