"""
Add Full-Text Search (FTS) to SQLite

This creates virtual tables that enable lightning-fast text search.
Much faster than LIKE queries!

Inspired by Midday's search optimization (they use Typesense, 
we use SQLite FTS which is perfect for desktop apps).
"""

import sqlite3
import sys
from pathlib import Path

# Get the database path
DB_PATH = Path(__file__).parent / "ritual.db"

def add_fts():
    """Add Full-Text Search virtual tables"""
    print("🔍 Adding Full-Text Search (FTS) to database...")
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        # Create FTS table for habits
        print("\n  📊 Creating habits_fts virtual table...")
        cursor.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS habits_fts 
            USING fts5(
                name,
                category,
                unit_type
            )
        """)
        
        # Populate FTS table with existing data
        print("  📝 Populating habits_fts with existing data...")
        cursor.execute("""
            INSERT INTO habits_fts(rowid, name, category, unit_type)
            SELECT 
                CAST(SUBSTR(id, 1, 16) AS INTEGER) % 9223372036854775807,
                name, 
                category,
                COALESCE(unit_type, '')
            FROM habits
        """)
        
        print(f"  ✅ Indexed {cursor.rowcount} habits")
        
        # Create triggers to keep FTS in sync with main table
        print("\n  🔄 Creating sync triggers...")
        
        # Insert trigger
        cursor.execute("""
            CREATE TRIGGER IF NOT EXISTS habits_fts_insert
            AFTER INSERT ON habits
            BEGIN
                INSERT INTO habits_fts(rowid, name, category, unit_type)
                VALUES (
                    CAST(SUBSTR(new.id, 1, 16) AS INTEGER) % 9223372036854775807,
                    new.name, 
                    new.category,
                    COALESCE(new.unit_type, '')
                );
            END
        """)
        
        # Update trigger
        cursor.execute("""
            CREATE TRIGGER IF NOT EXISTS habits_fts_update
            AFTER UPDATE ON habits
            BEGIN
                DELETE FROM habits_fts WHERE rowid = CAST(SUBSTR(old.id, 1, 16) AS INTEGER) % 9223372036854775807;
                INSERT INTO habits_fts(rowid, name, category, unit_type)
                VALUES (
                    CAST(SUBSTR(new.id, 1, 16) AS INTEGER) % 9223372036854775807,
                    new.name,
                    new.category,
                    COALESCE(new.unit_type, '')
                );
            END
        """)
        
        # Delete trigger
        cursor.execute("""
            CREATE TRIGGER IF NOT EXISTS habits_fts_delete
            AFTER DELETE ON habits
            BEGIN
                DELETE FROM habits_fts WHERE rowid = CAST(SUBSTR(old.id, 1, 16) AS INTEGER) % 9223372036854775807;
            END
        """)
        
        print("  ✅ Sync triggers created")
        
        conn.commit()
        
        # Test the FTS
        print("\n  🧪 Testing Full-Text Search...")
        cursor.execute("""
            SELECT COUNT(*) FROM habits_fts
        """)
        count = cursor.fetchone()[0]
        print(f"  📊 Total searchable habits: {count}")
        
        # Show example search
        if count > 0:
            cursor.execute("""
                SELECT name FROM habits_fts
                WHERE habits_fts MATCH 'walk OR read OR meditate'
                LIMIT 3
            """)
            results = cursor.fetchall()
            if results:
                print("\n  🔍 Example search results (walk OR read OR meditate):")
                for row in results:
                    print(f"    • {row[0]}")
        
        print("\n✅ Full-Text Search setup complete!")
        print("\n💡 Usage in your code:")
        print("   SELECT * FROM habits_fts WHERE habits_fts MATCH 'search_term'")
        print("   Much faster than: SELECT * FROM habits WHERE name LIKE '%search%'")
        
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

