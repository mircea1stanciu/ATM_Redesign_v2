#!/usr/bin/env python3
"""
Database inspection script to show Phase 2 messaging tables
"""

import os
import sqlite3


def inspect_database():
    """Inspect the UnifiedWork database for messaging tables"""
    db_path = "/Users/mcs_macbook_pro/Desktop/Proiecte Mircea/UnifiedWork/backend/unifiedwork.db"
    
    if not os.path.exists(db_path):
        print("❌ Database not found at:", db_path)
        return
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Get all table names
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cursor.fetchall()
    
    print("🗄️  UnifiedWork Database Tables:")
    print("=" * 50)
    
    messaging_tables = []
    other_tables = []
    
    for table in tables:
        table_name = table[0]
        if table_name in ['user_presence', 'conversations', 'conversation_participants', 'messages']:
            messaging_tables.append(table_name)
        else:
            other_tables.append(table_name)
    
    print("\n📱 Messaging Tables (Phase 2):")
    for table in messaging_tables:
        cursor.execute(f"PRAGMA table_info({table});")
        columns = cursor.fetchall()
        print(f"  ✅ {table}")
        for col in columns:
            print(f"     - {col[1]} ({col[2]})")
    
    print("\n📊 Other Tables:")
    for table in other_tables:
        cursor.execute(f"SELECT COUNT(*) FROM {table};")
        count = cursor.fetchone()[0]
        print(f"  • {table} ({count} records)")
    
    print("\n📈 Messaging Tables Status:")
    for table in messaging_tables:
        cursor.execute(f"SELECT COUNT(*) FROM {table};")
        count = cursor.fetchone()[0]
        print(f"  • {table}: {count} records")
    
    conn.close()
    print("\n✅ Database inspection complete!")

if __name__ == "__main__":
    inspect_database()
