"""
Migration: Add 2FA columns to users table
Date: 2025-10-25
Description: Adds two_fa_enabled and two_fa_secret columns to support Two-Factor Authentication
"""

import os
import sqlite3
import sys

# Add parent directory to path to import database module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def migrate():
    """Add 2FA columns to users table"""
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'unifiedwork.db')
    
    print(f"Migrating database: {db_path}")
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Check if columns already exist
        cursor.execute("PRAGMA table_info(users)")
        columns = [col[1] for col in cursor.fetchall()]
        
        if 'two_fa_enabled' in columns and 'two_fa_secret' in columns:
            print("✓ 2FA columns already exist. No migration needed.")
            return
        
        # Add two_fa_enabled column
        if 'two_fa_enabled' not in columns:
            print("Adding two_fa_enabled column...")
            cursor.execute("ALTER TABLE users ADD COLUMN two_fa_enabled BOOLEAN DEFAULT 0")
            print("✓ Added two_fa_enabled column")
        
        # Add two_fa_secret column
        if 'two_fa_secret' not in columns:
            print("Adding two_fa_secret column...")
            cursor.execute("ALTER TABLE users ADD COLUMN two_fa_secret VARCHAR")
            print("✓ Added two_fa_secret column")
        
        conn.commit()
        print("\n✅ Migration completed successfully!")
        
    except Exception as e:
        conn.rollback()
        print(f"\n❌ Migration failed: {e}")
        raise
    finally:
        conn.close()

def rollback():
    """Rollback migration (remove 2FA columns)"""
    print("Note: SQLite doesn't support DROP COLUMN directly.")
    print("To rollback, you would need to:")
    print("1. Create a new table without 2FA columns")
    print("2. Copy data from old table to new table")
    print("3. Drop old table and rename new table")
    print("\nThis is not implemented in this script to prevent accidental data loss.")

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == 'rollback':
        rollback()
    else:
        migrate()
