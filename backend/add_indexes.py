"""
Add Database Indexes for Performance

This script adds indexes to the SQLite database to speed up queries.
Indexes make the database 10-100x faster for common queries!

Inspired by Midday's database optimization approach.
"""

import sqlite3
import sys
from pathlib import Path

# Get the database path
DB_PATH = Path(__file__).parent / "ritual.db"

def add_indexes():
    """Add indexes to improve query performance"""
    print("🔧 Adding database indexes for performance optimization...")
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # List of indexes to create
    indexes = [
        # Habit Logs indexes (most queried table)
        ("idx_habit_logs_habit_id", "habit_logs", "habit_id"),
        ("idx_habit_logs_date", "habit_logs", "date"),
        ("idx_habit_logs_user_id", "habit_logs", "user_id"),
        ("idx_habit_logs_status", "habit_logs", "status"),
        ("idx_habit_logs_habit_date", "habit_logs", "habit_id, date"),  # Composite index
        
        # Habits indexes
        ("idx_habits_user_id", "habits", "user_id"),
        ("idx_habits_created_at", "habits", "created_at"),
        
        # User indexes (if user table exists)
        # ("idx_users_email", "users", "email"),
    ]
    
    created_count = 0
    skipped_count = 0
    
    for index_name, table_name, columns in indexes:
        try:
            # Check if index already exists
            cursor.execute(f"""
                SELECT name FROM sqlite_master 
                WHERE type='index' AND name=?
            """, (index_name,))
            
            if cursor.fetchone():
                print(f"  ⏭️  Index {index_name} already exists, skipping...")
                skipped_count += 1
                continue
            
            # Create the index
            create_sql = f"CREATE INDEX {index_name} ON {table_name}({columns})"
            print(f"  ➕ Creating index: {index_name}")
            cursor.execute(create_sql)
            created_count += 1
            
        except sqlite3.Error as e:
            print(f"  ⚠️  Warning: Could not create {index_name}: {e}")
    
    conn.commit()
    
    # Show index statistics
    print("\n📊 Index Summary:")
    print(f"  ✅ Created: {created_count}")
    print(f"  ⏭️  Skipped (already exist): {skipped_count}")
    print(f"  📈 Total indexes: {created_count + skipped_count}")
    
    # Show all indexes
    print("\n📋 All indexes in database:")
    cursor.execute("""
        SELECT name, tbl_name, sql 
        FROM sqlite_master 
        WHERE type='index' AND name LIKE 'idx_%'
        ORDER BY tbl_name, name
    """)
    
    for row in cursor.fetchall():
        print(f"  • {row[0]} on {row[1]}")
    
    conn.close()
    print("\n✅ Database optimization complete!")

if __name__ == "__main__":
    try:
        add_indexes()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)

