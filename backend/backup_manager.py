#!/usr/bin/env python3
"""
Database Backup Management Script

This script helps you manage database backups safely.

Commands:
  python backup_manager.py backup        - Create a new backup with timestamp
  python backup_manager.py restore       - Restore from the latest backup
  python backup_manager.py list          - List all available backups
  python backup_manager.py restore <file> - Restore from specific backup file
"""
import os
import shutil
import sqlite3
import sys
from datetime import datetime

DB_FILE = "unifiedwork.db"
BACKUP_DIR = "backups"
SAFE_BACKUP = os.path.join(BACKUP_DIR, "safe_backup.db")

def ensure_backup_dir():
    """Ensure backup directory exists"""
    if not os.path.exists(BACKUP_DIR):
        os.makedirs(BACKUP_DIR)
        print(f"✅ Created backup directory: {BACKUP_DIR}")

def create_backup():
    """Create a timestamped backup of the database"""
    ensure_backup_dir()
    
    if not os.path.exists(DB_FILE):
        print(f"❌ Database file '{DB_FILE}' not found!")
        return False
    
    # Create timestamped backup
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = os.path.join(BACKUP_DIR, f"backup_{timestamp}.db")
    
    try:
        # Copy the database file
        shutil.copy2(DB_FILE, backup_file)
        print(f"✅ Created backup: {backup_file}")
        
        # Also update the safe backup (always keep latest)
        shutil.copy2(DB_FILE, SAFE_BACKUP)
        print(f"✅ Updated safe backup: {SAFE_BACKUP}")
        
        # Get database stats
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute("SELECT COUNT(*) FROM organizations")
        orgs = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM users")
        users = cursor.fetchone()[0]
        
        conn.close()
        
        print("\n📊 Backup contains:")
        print(f"   • Organizations: {orgs}")
        print(f"   • Users: {users}")
        print("\n💾 Backup saved successfully!\n")
        
        return True
        
    except Exception as e:
        print(f"❌ Backup failed: {e}")
        return False

def list_backups():
    """List all available backups"""
    ensure_backup_dir()
    
    backups = []
    if os.path.exists(BACKUP_DIR):
        for file in os.listdir(BACKUP_DIR):
            if file.endswith('.db'):
                filepath = os.path.join(BACKUP_DIR, file)
                size = os.path.getsize(filepath)
                mtime = os.path.getmtime(filepath)
                date = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")
                backups.append((file, size, date, filepath))
    
    if not backups:
        print("📁 No backups found.")
        return
    
    print("="*80)
    print("📦 AVAILABLE BACKUPS")
    print("="*80)
    
    # Sort by date (newest first)
    backups.sort(key=lambda x: x[2], reverse=True)
    
    for i, (filename, size, date, filepath) in enumerate(backups, 1):
        size_mb = size / (1024 * 1024)
        marker = "⭐" if filename == "safe_backup.db" else "  "
        print(f"{marker} {i}. {filename}")
        print(f"      Date: {date}")
        print(f"      Size: {size_mb:.2f} MB")
        
        # Show what's in the backup
        try:
            conn = sqlite3.connect(filepath)
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM organizations")
            orgs = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM users")
            users = cursor.fetchone()[0]
            conn.close()
            print(f"      Contains: {orgs} organizations, {users} users")
        except Exception:
            print("      Contains: Unable to read")
        
        print()
    
    print("="*80)
    print("⭐ = Safe backup (always kept up-to-date)")
    print("="*80 + "\n")

def restore_backup(backup_file=None):
    """Restore database from backup"""
    ensure_backup_dir()
    
    # If no specific file provided, use safe backup
    if backup_file is None:
        backup_file = SAFE_BACKUP
    elif not backup_file.startswith(BACKUP_DIR):
        backup_file = os.path.join(BACKUP_DIR, backup_file)
    
    if not os.path.exists(backup_file):
        print(f"❌ Backup file not found: {backup_file}")
        print("\n💡 Available backups:")
        list_backups()
        return False
    
    # Create a backup of current database before restoring
    if os.path.exists(DB_FILE):
        pre_restore_backup = os.path.join(BACKUP_DIR, f"pre_restore_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db")
        shutil.copy2(DB_FILE, pre_restore_backup)
        print(f"⚠️  Created backup of current database: {pre_restore_backup}")
    
    try:
        # Restore the backup
        shutil.copy2(backup_file, DB_FILE)
        print(f"✅ Database restored from: {backup_file}")
        
        # Show what was restored
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute("SELECT COUNT(*) FROM organizations")
        orgs = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM users")
        users = cursor.fetchone()[0]
        
        conn.close()
        
        print("\n📊 Restored database contains:")
        print(f"   • Organizations: {orgs}")
        print(f"   • Users: {users}")
        print("\n✅ Restore completed successfully!\n")
        
        return True
        
    except Exception as e:
        print(f"❌ Restore failed: {e}")
        return False

def show_help():
    """Show help message"""
    print("""
╔══════════════════════════════════════════════════════════════════════════════╗
║                       DATABASE BACKUP MANAGER                                ║
╚══════════════════════════════════════════════════════════════════════════════╝

📦 COMMANDS:

  backup              Create a new timestamped backup + update safe backup
  restore             Restore from the safe backup (latest)
  restore <filename>  Restore from a specific backup file
  list                List all available backups
  help                Show this help message

📁 BACKUP LOCATIONS:

  Safe Backup:        backups/safe_backup.db (always latest)
  Timestamped:        backups/backup_YYYYMMDD_HHMMSS.db

💡 EXAMPLES:

  python backup_manager.py backup
  python backup_manager.py list
  python backup_manager.py restore
  python backup_manager.py restore backup_20251025_143022.db

🔒 SAFETY FEATURES:

  • Always creates a backup before restoring
  • Maintains timestamped history
  • Safe backup is automatically updated on each backup

╚══════════════════════════════════════════════════════════════════════════════╝
""")

def main():
    if len(sys.argv) < 2:
        show_help()
        return
    
    command = sys.argv[1].lower()
    
    if command == "backup":
        create_backup()
    
    elif command == "restore":
        if len(sys.argv) > 2:
            restore_backup(sys.argv[2])
        else:
            print("🔄 Restoring from safe backup...")
            restore_backup()
    
    elif command == "list":
        list_backups()
    
    elif command == "help":
        show_help()
    
    else:
        print(f"❌ Unknown command: {command}")
        show_help()

if __name__ == "__main__":
    main()
