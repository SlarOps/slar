# SLAR AI Tests

This directory contains tests for the refactored SLAR AI modules.

## Running Tests

### Run all tests
```bash
cd /Users/chonle/Documents/feee/slar-oss/api/ai
pytest tests/
```

### Run specific test file
```bash
pytest tests/test_config.py
```

### Run with coverage
```bash
pytest --cov=. tests/
```

### Run with verbose output
```bash
pytest -v tests/
```

## Test Structure

- `test_config.py`: Tests for configuration module
- `test_models.py`: Tests for data models/schemas
- `test_utils.py`: Tests for utility functions

## Adding New Tests

When adding new functionality:
1. Create corresponding test file in `tests/`
2. Follow naming convention: `test_<module_name>.py`
3. Use descriptive test function names: `test_<what_is_being_tested>()`
4. Include docstrings explaining what each test validates

## Test Requirements

Make sure these packages are installed:
```bash
pip install pytest pytest-cov pytest-asyncio
```
