#!/usr/bin/env python3
"""
Test script to check if the backend endpoints are working
"""

import asyncio
import httpx
import json

async def test_endpoint(client: httpx.AsyncClient, endpoint: str, description: str):
    """Test a single endpoint"""
    try:
        print(f"🔄 Testing {description}...")
        response = await client.get(f"http://127.0.0.1:8000{endpoint}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ {description} - SUCCESS")
            print(f"   Response: {json.dumps(data, indent=2)[:200]}...")
            return True
        else:
            print(f"❌ {description} - FAILED (Status: {response.status_code})")
            print(f"   Response: {response.text[:200]}...")
            return False
            
    except Exception as e:
        print(f"❌ {description} - ERROR: {str(e)}")
        return False

async def main():
    """Test all endpoints"""
    print("🧪 Testing Ritual Backend Endpoints...")
    print("=" * 50)
    
    endpoints = [
        ("/", "Root endpoint"),
        ("/health", "Health check"),
        ("/test/models", "Models test"),
        ("/test/database", "Database test"),
        ("/test/tinybird", "Tinybird test"),
    ]
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        passed = 0
        total = len(endpoints)
        
        for endpoint, description in endpoints:
            if await test_endpoint(client, endpoint, description):
                passed += 1
            print()  # Add spacing between tests
    
    print("=" * 50)
    print(f"📊 Test Results: {passed}/{total} endpoints working")
    
    if passed == total:
        print("🎉 All endpoints are working!")
        print("\n📝 Your backend is ready for:")
        print("  - Frontend integration")
        print("  - Habit management")
        print("  - Tinybird analytics")
        print("  - Real-time features")
    else:
        print("⚠️  Some endpoints have issues, but basic functionality may still work")
    
    return passed == total

if __name__ == "__main__":
    print("⏳ Waiting 3 seconds for server to start...")
    import time
    time.sleep(3)
    
    success = asyncio.run(main())
    exit(0 if success else 1)
