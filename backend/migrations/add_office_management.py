"""
Database migration: Add Office Management tables
Run this script to add tables for office desks, parking spaces, and bookings
"""

import sqlite3
import sys
from pathlib import Path

# Add parent directory to path to import database module
sys.path.append(str(Path(__file__).parent.parent))

def migrate():
    """Add office management tables to database"""
    try:
        print("🔄 Starting Office Management migration...")
        
        conn = sqlite3.connect('unifiedwork.db')
        cursor = conn.cursor()
        
        # Create office_desks table
        print("  Creating office_desks table...")
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS office_desks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id INTEGER NOT NULL,
                desk_number VARCHAR(50) NOT NULL,
                floor VARCHAR(20),
                building VARCHAR(100),
                section VARCHAR(100),
                description TEXT,
                has_monitor BOOLEAN DEFAULT 0,
                has_docking_station BOOLEAN DEFAULT 0,
                has_standing_desk BOOLEAN DEFAULT 0,
                equipment_notes TEXT,
                status VARCHAR(20) DEFAULT 'available',
                is_active BOOLEAN DEFAULT 1,
                is_bookable BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by_user_id INTEGER,
                FOREIGN KEY (organization_id) REFERENCES organizations(id),
                FOREIGN KEY (created_by_user_id) REFERENCES users(id),
                UNIQUE (organization_id, desk_number)
            )
        ''')
        
        # Create parking_spaces table
        print("  Creating parking_spaces table...")
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS parking_spaces (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id INTEGER NOT NULL,
                space_number VARCHAR(50) NOT NULL,
                level VARCHAR(20),
                location VARCHAR(100),
                building VARCHAR(100),
                description TEXT,
                is_covered BOOLEAN DEFAULT 0,
                has_ev_charging BOOLEAN DEFAULT 0,
                is_handicap BOOLEAN DEFAULT 0,
                space_type VARCHAR(50),
                status VARCHAR(20) DEFAULT 'available',
                is_active BOOLEAN DEFAULT 1,
                is_bookable BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by_user_id INTEGER,
                FOREIGN KEY (organization_id) REFERENCES organizations(id),
                FOREIGN KEY (created_by_user_id) REFERENCES users(id),
                UNIQUE (organization_id, space_number)
            )
        ''')
        
        # Create desk_bookings table
        print("  Creating desk_bookings table...")
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS desk_bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                desk_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                organization_id INTEGER NOT NULL,
                booking_date DATE NOT NULL,
                check_in_time TIMESTAMP,
                check_out_time TIMESTAMP,
                status VARCHAR(20) DEFAULT 'confirmed',
                notes TEXT,
                cancellation_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                cancelled_at TIMESTAMP,
                FOREIGN KEY (desk_id) REFERENCES office_desks(id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (organization_id) REFERENCES organizations(id),
                UNIQUE (user_id, booking_date)
            )
        ''')
        
        # Create parking_bookings table
        print("  Creating parking_bookings table...")
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS parking_bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                parking_space_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                organization_id INTEGER NOT NULL,
                booking_date DATE NOT NULL,
                vehicle_plate VARCHAR(20),
                check_in_time TIMESTAMP,
                check_out_time TIMESTAMP,
                status VARCHAR(20) DEFAULT 'confirmed',
                notes TEXT,
                cancellation_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                cancelled_at TIMESTAMP,
                FOREIGN KEY (parking_space_id) REFERENCES parking_spaces(id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (organization_id) REFERENCES organizations(id),
                UNIQUE (user_id, booking_date)
            )
        ''')
        
        # Create office_settings table
        print("  Creating office_settings table...")
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS office_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id INTEGER NOT NULL UNIQUE,
                allow_desk_booking BOOLEAN DEFAULT 1,
                allow_parking_booking BOOLEAN DEFAULT 1,
                advance_booking_days INTEGER DEFAULT 14,
                booking_deadline_hour INTEGER DEFAULT 22,
                allow_same_day_booking BOOLEAN DEFAULT 1,
                allow_cancellation BOOLEAN DEFAULT 1,
                cancellation_deadline_hours INTEGER DEFAULT 12,
                require_desk_check_in BOOLEAN DEFAULT 0,
                auto_release_desk_minutes INTEGER DEFAULT 30,
                require_parking_check_in BOOLEAN DEFAULT 0,
                require_vehicle_plate BOOLEAN DEFAULT 0,
                send_booking_confirmation BOOLEAN DEFAULT 1,
                send_reminder_email BOOLEAN DEFAULT 1,
                reminder_hours_before INTEGER DEFAULT 24,
                office_start_hour INTEGER DEFAULT 8,
                office_end_hour INTEGER DEFAULT 18,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (organization_id) REFERENCES organizations(id)
            )
        ''')
        
        # Create indexes for better performance
        print("  Creating indexes...")
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_desks_org ON office_desks(organization_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_desks_status ON office_desks(status)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_parking_org ON parking_spaces(organization_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_parking_status ON parking_spaces(status)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_desk_bookings_date ON desk_bookings(booking_date)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_desk_bookings_user ON desk_bookings(user_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_parking_bookings_date ON parking_bookings(booking_date)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_parking_bookings_user ON parking_bookings(user_id)')
        
        conn.commit()
        print("✅ Office Management migration completed successfully!")
        
        # Verify tables were created
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'office_%' OR name LIKE 'parking_%' OR name LIKE 'desk_%'")
        tables = cursor.fetchall()
        print(f"\n📊 Created tables: {', '.join([t[0] for t in tables])}")
        
        conn.close()
        return True
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        return False


if __name__ == "__main__":
    success = migrate()
    sys.exit(0 if success else 1)
