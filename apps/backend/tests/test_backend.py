#!/usr/bin/env python3
"""
Simple test script to verify the backend works without external dependencies
"""

import sys
import os
from pathlib import Path

# Add the backend directory to Python path
sys.path.insert(0, str(Path(__file__).parent))

def test_imports():
    """Test that all required modules can be imported"""
    try:
        print("🔄 Testing imports...")
        
        import fastapi
        print("✅ FastAPI imported")
        
        import uvicorn
        print("✅ Uvicorn imported")
        
        import sqlalchemy
        print("✅ SQLAlchemy imported")
        
        import pydantic
        print("✅ Pydantic imported")
        
        import jwt
        print("✅ PyJWT imported")
        
        from models.habit_models import Habit, HabitCreate
        print("✅ Habit models imported")
        
        from database.models import Base, HabitDB
        print("✅ Database models imported")
        
        print("✅ All imports successful!")
        return True
        
    except ImportError as e:
        print(f"❌ Import error: {e}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

def test_fastapi_app():
    """Test that FastAPI app can be created"""
    try:
        print("\n🔄 Testing FastAPI app creation...")
        
        from fastapi import FastAPI
        app = FastAPI(title="Test App")
        
        @app.get("/test")
        def test_endpoint():
            return {"message": "test successful"}
        
        print("✅ FastAPI app created successfully!")
        return True
        
    except Exception as e:
        print(f"❌ FastAPI app creation failed: {e}")
        return False

def test_database_models():
    """Test that database models can be created"""
    try:
        print("\n🔄 Testing database models...")
        
        from sqlalchemy import create_engine
        from database.models import Base
        
        # Create in-memory SQLite database for testing
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        
        print("✅ Database models created successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Database model creation failed: {e}")
        return False

def main():
    """Run all tests"""
    print("🧪 Testing Ritual Backend Components...")
    print("=" * 50)
    
    tests = [
        ("Import Test", test_imports),
        ("FastAPI Test", test_fastapi_app),
        ("Database Test", test_database_models),
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        print(f"\n📋 Running {test_name}...")
        if test_func():
            passed += 1
        else:
            print(f"❌ {test_name} failed!")
    
    print("\n" + "=" * 50)
    print(f"📊 Test Results: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! Backend is ready to run.")
        print("\n📝 Next steps:")
        print("1. Configure your .env file with Tinybird credentials")
        print("2. Run: python start.py")
        print("3. Visit: http://localhost:8000/docs")
        return True
    else:
        print("❌ Some tests failed. Please check the errors above.")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
