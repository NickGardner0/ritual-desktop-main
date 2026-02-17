"""
Verification script for habits database
Run this to see what habits are currently in your database
"""
import sqlite3

def verify_database():
    conn = sqlite3.connect('ritual.db')
    cursor = conn.cursor()
    
    print("=" * 60)
    print("HABITS DATABASE VERIFICATION")
    print("=" * 60)
    
    # Get all unique user IDs
    cursor.execute('SELECT DISTINCT user_id FROM habits')
    user_ids = cursor.fetchall()
    
    print(f"\n📊 Found {len(user_ids)} unique user(s) in database:")
    for (user_id,) in user_ids:
        print(f"  - {user_id}")
    
    # For each user, show their habits
    for (user_id,) in user_ids:
        print(f"\n{'='*60}")
        print(f"Habits for user: {user_id}")
        print(f"{'='*60}")
        
        cursor.execute('''
            SELECT id, name, category, icon, unit_type, created_at 
            FROM habits 
            WHERE user_id = ?
            ORDER BY created_at DESC
        ''', (user_id,))
        
        habits = cursor.fetchall()
        
        if habits:
            for i, (habit_id, name, category, icon, unit_type, created_at) in enumerate(habits, 1):
                print(f"\n{i}. {name}")
                print(f"   ID: {habit_id}")
                print(f"   Category: {category}")
                print(f"   Icon: {icon}")
                print(f"   Unit Type: {unit_type}")
                print(f"   Created: {created_at}")
                
                # Check for logs
                cursor.execute('SELECT COUNT(*) FROM habit_logs WHERE habit_id = ?', (habit_id,))
                log_count = cursor.fetchone()[0]
                print(f"   Logs: {log_count}")
        else:
            print("  No habits found")
    
    # Summary
    cursor.execute('SELECT COUNT(*) FROM habits')
    total_habits = cursor.fetchone()[0]
    
    cursor.execute('SELECT COUNT(*) FROM habit_logs')
    total_logs = cursor.fetchone()[0]
    
    print(f"\n{'='*60}")
    print(f"SUMMARY")
    print(f"{'='*60}")
    print(f"Total habits: {total_habits}")
    print(f"Total logs: {total_logs}")
    
    conn.close()

if __name__ == "__main__":
    verify_database()

