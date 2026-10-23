"""
Database migration: Add AI model configuration fields to organizations table
Run this script to add ai_model_tier and ai_model_name columns
"""

import sqlite3
import sys
from pathlib import Path

# Add parent directory to path to import database module
sys.path.append(str(Path(__file__).parent.parent))

def migrate():
    """Add AI model fields to organizations table"""
    db_path = Path(__file__).parent.parent / "unifiedwork.db"
    
    if not db_path.exists():
        print(f"❌ Database not found at {db_path}")
        return False
    
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        print("🔄 Starting migration: Add AI model fields...")
        
        # Check if columns already exist
        cursor.execute("PRAGMA table_info(organizations)")
        columns = [col[1] for col in cursor.fetchall()]
        
        migrations_applied = []
        
        # Add ai_model_tier column
        if "ai_model_tier" not in columns:
            cursor.execute("""
                ALTER TABLE organizations 
                ADD COLUMN ai_model_tier VARCHAR DEFAULT 'standard'
            """)
            migrations_applied.append("ai_model_tier")
            print("  ✅ Added ai_model_tier column")
        else:
            print("  ℹ️  ai_model_tier column already exists")
        
        # Add ai_model_name column
        if "ai_model_name" not in columns:
            cursor.execute("""
                ALTER TABLE organizations 
                ADD COLUMN ai_model_name VARCHAR
            """)
            migrations_applied.append("ai_model_name")
            print("  ✅ Added ai_model_name column")
        else:
            print("  ℹ️  ai_model_name column already exists")
        
        # Set default values for existing organizations
        if migrations_applied:
            cursor.execute("""
                UPDATE organizations 
                SET ai_model_tier = 'standard',
                    ai_model_name = 'gpt-4o-mini'
                WHERE ai_model_name IS NULL
            """)
            print("  ✅ Set default values for existing organizations")
        
        conn.commit()
        conn.close()
        
        if migrations_applied:
            print(f"\n✅ Migration completed successfully! Added: {', '.join(migrations_applied)}")
        else:
            print("\n✅ No migration needed - all columns already exist")
        
        return True
        
    except Exception as e:
        print(f"\n❌ Migration failed: {e}")
        if 'conn' in locals():
            conn.rollback()
            conn.close()
        return False


if __name__ == "__main__":
    success = migrate()
    sys.exit(0 if success else 1)
