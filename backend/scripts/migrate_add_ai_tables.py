#!/usr/bin/env python3
"""
Migration script to add AI conversation tables to existing database.
Run this to add ai_conversations and ai_messages tables without affecting existing data.

Usage:
  cd backend
  python3 scripts/migrate_add_ai_tables.py
"""

import os
import sys
import asyncio
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
from sqlalchemy import text
from database.connection import engine, async_session_factory
from database.models import Base, AIConversationDB, AIMessageDB

# Load environment variables
load_dotenv()


async def check_table_exists(table_name: str) -> bool:
    """Check if a specific table exists."""
    async with async_session_factory() as session:
        try:
            result = await session.execute(
                text(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}'")
            )
            return result.fetchone() is not None
        except Exception as e:
            print(f"Error checking table {table_name}: {e}")
            return False


async def create_ai_tables():
    """Create AI conversation tables if they don't exist."""
    print("🗄️  AI Conversation Tables Migration")
    print("=" * 50)
    
    # Check if tables already exist
    conversations_exists = await check_table_exists('ai_conversations')
    messages_exists = await check_table_exists('ai_messages')
    
    if conversations_exists and messages_exists:
        print("✅ AI tables already exist. No migration needed.")
        return True
    
    if conversations_exists:
        print("⚠️  ai_conversations exists, but ai_messages is missing.")
    if messages_exists:
        print("⚠️  ai_messages exists, but ai_conversations is missing.")
    
    print("\n📝 Creating AI conversation tables...")
    
    try:
        async with engine.begin() as conn:
            # Create only the AI tables
            def create_tables(sync_conn):
                # Use checkfirst=True to safely create tables that don't exist
                AIConversationDB.__table__.create(sync_conn, checkfirst=True)
                AIMessageDB.__table__.create(sync_conn, checkfirst=True)
            
            await conn.run_sync(create_tables)
        
        print("✅ AI tables created successfully")
        
    except Exception as e:
        print(f"❌ Error creating tables: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    # Verify tables were created
    print("\n🔍 Verifying table creation...")
    
    conversations_exists = await check_table_exists('ai_conversations')
    messages_exists = await check_table_exists('ai_messages')
    
    if conversations_exists and messages_exists:
        print("✅ ai_conversations table: created")
        print("✅ ai_messages table: created")
        print("\n" + "=" * 50)
        print("🎉 Migration complete!")
        print("\nAI chat persistence is now enabled.")
        return True
    else:
        print("❌ Migration verification failed")
        return False


async def main():
    try:
        success = await create_ai_tables()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())

