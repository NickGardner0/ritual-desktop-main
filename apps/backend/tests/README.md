# Backend Tests & Debug Scripts

This directory contains test files and debug utilities for the Ritual backend.

## Test Files

- `test_backend.py` - Backend integration tests
- `test_endpoints.py` - API endpoint tests
- `simple_test.py` - Simple backend connectivity tests
- `test_ritual.db` - Test database (not for production use)

## Debug Utilities

- `debug_habits.py` - Debug script for habit data
- `verify_habits.py` - Verification script for habit consistency

## Running Tests

```bash
# From the backend directory
python -m pytest tests/

# Run specific test file
python tests/test_backend.py
```

## Note

These are legacy test files. Consider migrating to a proper test framework like pytest with proper fixtures and test structure.

