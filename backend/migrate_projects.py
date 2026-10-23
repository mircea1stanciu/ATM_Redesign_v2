"""
Database Migration: Add Project Management Tables
"""
from sqlalchemy import inspect

from core.database import Base, engine


def run_migration():
    """Create project management tables"""
    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()
    
    print("🔄 Starting project management database migration...")
    print(f"📊 Current tables: {existing_tables}")
    
    # Create all project management tables
    try:
        Base.metadata.create_all(bind=engine, checkfirst=True)
        print("✅ Migration completed successfully!")
        
        # Verify new tables
        inspector = inspect(engine)
        new_tables = inspector.get_table_names()
        added_tables = set(new_tables) - set(existing_tables)
        
        if added_tables:
            print(f"📋 Added tables: {', '.join(added_tables)}")
        else:
            print("ℹ️  All tables already exist (no new tables created)")
        
        print("\n📊 All tables in database:")
        for table in sorted(new_tables):
            print(f"   - {table}")
            
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        raise

if __name__ == "__main__":
    run_migration()
