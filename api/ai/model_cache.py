#!/usr/bin/env python3
"""
Model cache manager for SLAR AI
Optimizes model loading with persistent cache
"""

import os
import sys
from pathlib import Path
import chromadb
from chromadb.utils import embedding_functions

def setup_cache_directories():
    """Setup cache directories for models"""
    cache_dirs = [
        os.getenv('HF_HOME', '/data/huggingface'),
        os.getenv('TRANSFORMERS_CACHE', '/data/transformers'),
        os.getenv('SENTENCE_TRANSFORMERS_HOME', '/data/sentence_transformers'),
        os.getenv('CHROMA_CACHE_DIR', '/data/chroma')
    ]
    
    for cache_dir in cache_dirs:
        Path(cache_dir).mkdir(parents=True, exist_ok=True)
        print(f"✓ Cache directory ready: {cache_dir}")
    
    # Set ChromaDB cache path if not already set
    if 'CHROMA_CACHE_DIR' not in os.environ:
        os.environ['CHROMA_CACHE_DIR'] = '/data/chroma'

def check_model_cache(model_name='all-MiniLM-L6-v2'):
    """Check if model is already cached"""
    cache_dir = os.getenv('SENTENCE_TRANSFORMERS_HOME', '/data/sentence_transformers')
    model_path = Path(cache_dir) / model_name
    
    if model_path.exists():
        print(f"✓ Model {model_name} found in cache: {model_path}")
        return True
    else:
        print(f"⚠ Model {model_name} not found in cache: {model_path}")
        return False

def download_model_if_needed(model_name='all-MiniLM-L6-v2'):
    """Download model only if not cached"""
    if check_model_cache(model_name):
        print(f"✓ Using cached model: {model_name}")
        return True
    
    try:
        print(f"📥 Downloading model: {model_name}")
        ef = embedding_functions.SentenceTransformerEmbeddingFunction(model_name=model_name)
        
        # Test the model
        print("🧪 Testing model...")
        result = ef(['test'])
        print(f"✅ Model {model_name} downloaded and tested successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Error downloading model {model_name}: {e}")
        return False

def get_embedding_function(model_name='all-MiniLM-L6-v2'):
    """Get embedding function with optimized loading"""
    setup_cache_directories()
    
    # Try to use cached model first
    try:
        ef = embedding_functions.SentenceTransformerEmbeddingFunction(model_name=model_name)
        return ef
    except Exception as e:
        print(f"⚠ Error loading model {model_name}: {e}")
        raise

if __name__ == "__main__":
    """CLI interface for model management"""
    if len(sys.argv) > 1:
        command = sys.argv[1]
        model_name = sys.argv[2] if len(sys.argv) > 2 else 'all-MiniLM-L6-v2'
        
        if command == "download":
            setup_cache_directories()
            download_model_if_needed(model_name)
        elif command == "check":
            check_model_cache(model_name)
        elif command == "setup":
            setup_cache_directories()
        else:
            print("Usage: python model_cache.py [download|check|setup] [model_name]")
    else:
        # Default: setup and check
        setup_cache_directories()
        download_model_if_needed()
