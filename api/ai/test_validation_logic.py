
import sys
from pathlib import Path
import re

# Mocking the logic from git_utils.py and routes_marketplace.py
# Since we can't easily import from the project due to dependencies

class GitError(Exception):
    pass

def get_marketplace_dir(workspace_path: Path, marketplace_name: str) -> Path:
    # Resolve the base directory
    marketplaces_root = (workspace_path / ".claude" / "plugins" / "marketplaces").resolve()
    
    # Compute and resolve candidate
    candidate_dir = (marketplaces_root / marketplace_name).resolve()
    
    # Security Check
    if not candidate_dir.is_relative_to(marketplaces_root):
        raise GitError(f"Path traversal attempt detected: {marketplace_name}")
        
    return candidate_dir

_MARKETPLACE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+$")

def is_valid_marketplace_name(name: str) -> bool:
    if not name:
        return False
    return bool(_MARKETPLACE_NAME_PATTERN.fullmatch(name))

def test_logic():
    workspace = Path("/home/user/workspace")
    # In reality, Path.resolve() needs the path to exist or it might behave differently on some OSs.
    # However, Path objects in Python can still resolve relative parts syntactically even if they don't exist.
    
    test_cases = [
        ("anthropic-agent-skills", True, True),
        ("my.marketplace_v1", True, True),
        ("..", False, False),
        ("../traversal", False, False),
        ("name/with/slash", False, False),
        ("name\\with\\backslash", False, False),
        ("", False, False),
        (".", False, True), # Regex allows dot, but resolve might hit it. Actually "." resolves to marketplaces_root.
        ("valid-name", True, True),
    ]
    
    print(f"{'Input':<25} | {'Regex':<6} | {'Path.resolve':<12}")
    print("-" * 50)
    
    for name, expected_regex, expected_path in test_cases:
        regex_result = is_valid_marketplace_name(name)
        
        path_result = False
        try:
            get_marketplace_dir(workspace, name)
            path_result = True
        except GitError:
            path_result = False
        except Exception as e:
            path_result = f"Error: {e}"
            
        print(f"{name:<25} | {str(regex_result):<6} | {str(path_result):<12}")

if __name__ == "__main__":
    test_logic()
