#!/usr/bin/env python3
"""
Clear the local Turso replica cache to force a fresh sync
Run this if your local replica is out of sync with Turso Cloud
"""

import os
import tempfile
from pathlib import Path

def main():
    # This is the same path used in database/connection.py
    local_db_path = os.path.join(tempfile.gettempdir(), "ritual_turso_replica.db")
    
    print("🔍 Checking for local Turso replica...")
    print(f"   Path: {local_db_path}")
    
    if os.path.exists(local_db_path):
        print(f"\n✅ Found local replica file")
        file_size = os.path.getsize(local_db_path)
        print(f"   Size: {file_size:,} bytes")
        
        response = input("\n⚠️  Delete this file to force a fresh sync? (yes/no): ")
        if response.lower() == 'yes':
            try:
                os.remove(local_db_path)
                print("\n✅ Local replica deleted successfully!")
                print("\n📝 Next steps:")
                print("   1. Restart your backend server")
                print("   2. The replica will automatically sync from Turso Cloud")
                print("   3. Your app should now work correctly")
            except Exception as e:
                print(f"\n❌ Error deleting file: {e}")
        else:
            print("\n❌ Cancelled. No changes made.")
    else:
        print("\n⚠️  No local replica found at this location")
        print("   This might mean:")
        print("   - The replica hasn't been created yet (start backend first)")
        print("   - The replica path has changed")
        
        # Check for any .db files in temp directory
        print(f"\n🔍 Searching for .db files in {tempfile.gettempdir()}...")
        temp_dir = Path(tempfile.gettempdir())
        db_files = list(temp_dir.glob("*turso*.db")) + list(temp_dir.glob("*ritual*.db"))
        
        if db_files:
            print(f"\n   Found {len(db_files)} related database file(s):")
            for db_file in db_files:
                size = db_file.stat().st_size
                print(f"   - {db_file.name} ({size:,} bytes)")
        else:
            print("   No related .db files found")

if __name__ == "__main__":
    main()

