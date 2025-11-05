"""
Add Simple Full-Text Search (FTS) to SQLite

Simplified version that just indexes habit names for fast search.
"""

import sqlite3
import sys
from pathlib import Path

# Get the database path
DB_PATH = Path(__file__).parent / "ritual.db"

def add_fts():
    """Add Full-Text Search virtual table"""
    print("🔍 Adding Full-Text Search (FTS) to database...")
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        # Drop existing FTS table if it exists
        print("\n  🗑️  Cleaning up old FTS tables...")
        cursor.execute("DROP TABLE IF EXISTS habits_fts")
        cursor.execute("DROP TRIGGER IF EXISTS habits_fts_insert")
        cursor.execute("DROP TRIGGER IF EXISTS habits_fts_update")
        cursor.execute("DROP TRIGGER IF EXISTS habits_fts_delete")
        
        # Create FTS table for habits (simplified - just name and category)
        print("\n  📊 Creating habits_fts virtual table...")
        cursor.execute("""
            CREATE VIRTUAL TABLE habits_fts 
            USING fts5(
                habit_id UNINDEXED,
                name,
                category,
                content=''
            )
        """)
        
        # Populate FTS table with existing data
        print("  📝 Populating habits_fts with existing data...")
        cursor.execute("""
            INSERT INTO habits_fts(habit_id, name, category)
            SELECT id, name, category
            FROM habits
        """)
        
        count = cursor.rowcount
        print(f"  ✅ Indexed {count} habits")
        
        # Create triggers to keep FTS in sync
        print("\n  🔄 Creating sync triggers...")
        
        # Insert trigger
        cursor.execute("""
            CREATE TRIGGER habits_fts_insert
            AFTER INSERT ON habits
            BEGIN
                INSERT INTO habits_fts(habit_id, name, category)
                VALUES (new.id, new.name, new.category);
            END
        """)
        
        # Update trigger  
        cursor.execute("""
            CREATE TRIGGER habits_fts_update
            AFTER UPDATE ON habits
            BEGIN
                UPDATE habits_fts
                SET name = new.name,
                    category = new.category
                WHERE habit_id = old.id;
            END
        """)
        
        # Delete trigger
        cursor.execute("""
            CREATE TRIGGER habits_fts_delete
            AFTER DELETE ON habits
            BEGIN
                DELETE FROM habits_fts WHERE habit_id = old.id;
            END
        """)
        
        print("  ✅ Sync triggers created")
        
        conn.commit()
        
        # Test the FTS
        print("\n  🧪 Testing Full-Text Search...")
        cursor.execute("SELECT COUNT(*) FROM habits_fts")
        count = cursor.fetchone()[0]
        print(f"  📊 Total searchable habits: {count}")
        
        # Show example searches
        if count > 0:
            print("\n  🔍 Example searches:")
            
            test_queries = ["walk", "read", "meditate"]
            for query in test_queries:
                cursor.execute(f"""
                    SELECT name FROM habits_fts
                    WHERE habits_fts MATCH ?
                    LIMIT 3
                """, (query,))
                results = cursor.fetchall()
                if results:
                    print(f"    Search '{query}': {', '.join([r[0] for r in results])}")
        
        print("\n✅ Full-Text Search setup complete!")
        print("\n💡 Usage:")
        print("   Fast: SELECT * FROM habits_fts WHERE habits_fts MATCH 'walk'")
        print("   Old:  SELECT * FROM habits WHERE name LIKE '%walk%'  (slower)")
        
    except sqlite3.Error as e:
        print(f"\n❌ Error: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    try:
        add_fts()
    except Exception as e:
        print(f"\n❌ Failed: {e}")
        sys.exit(1)

