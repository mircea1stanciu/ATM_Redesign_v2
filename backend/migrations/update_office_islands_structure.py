"""
Migration: Update Office Management to Island-based Architecture
Changes desk booking from individual desks to island/area groups
"""

def upgrade():
    """Upgrade database to new island-based structure"""
    import os
    import sqlite3
    
    # Get the backend directory (parent of migrations folder)
    db_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), "unifiedwork.db")
    print(f"📂 Using database file: {db_file}")
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()
    
    try:
        print("🔄 Starting migration to island-based office management...")
        
        # Drop old tables that will be replaced
        cursor.execute("DROP TABLE IF EXISTS parking_bookings")
        cursor.execute("DROP TABLE IF EXISTS desk_bookings")
        cursor.execute("DROP TABLE IF EXISTS office_desks")
        cursor.execute("DROP TABLE IF EXISTS parking_spaces")
        cursor.execute("DROP TABLE IF EXISTS office_settings")
        cursor.execute("DROP TABLE IF EXISTS desk_islands")
        print("✅ Dropped old office tables")
        
        # Create new desk_islands table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS desk_islands (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id INTEGER NOT NULL,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                floor VARCHAR(20),
                building VARCHAR(100),
                location VARCHAR(200),
                total_desks INTEGER DEFAULT 0,
                available_desks INTEGER DEFAULT 0,
                has_monitors BOOLEAN DEFAULT 0,
                has_docking_stations BOOLEAN DEFAULT 0,
                has_standing_desks BOOLEAN DEFAULT 0,
                status VARCHAR(20) DEFAULT 'available',
                is_active BOOLEAN DEFAULT 1,
                is_bookable BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by_user_id INTEGER,
                FOREIGN KEY (organization_id) REFERENCES organizations(id),
                FOREIGN KEY (created_by_user_id) REFERENCES users(id),
                UNIQUE(organization_id, name)
            )
        """)
        print("✅ Created desk_islands table")
        
        # Create new office_desks table (updated)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS office_desks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id INTEGER NOT NULL,
                island_id INTEGER NOT NULL,
                desk_number VARCHAR(50) NOT NULL,
                position_in_island INTEGER,
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
                FOREIGN KEY (island_id) REFERENCES desk_islands(id),
                FOREIGN KEY (created_by_user_id) REFERENCES users(id),
                UNIQUE(organization_id, desk_number)
            )
        """)
        print("✅ Created office_desks table (updated)")
        
        # Create island_bookings table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS island_bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                island_id INTEGER NOT NULL,
                community_name VARCHAR(100) NOT NULL,
                booked_by_user_id INTEGER NOT NULL,
                organization_id INTEGER NOT NULL,
                booking_date DATE NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                team_size INTEGER,
                status VARCHAR(20) DEFAULT 'confirmed',
                notes TEXT,
                cancellation_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                cancelled_at TIMESTAMP,
                FOREIGN KEY (island_id) REFERENCES desk_islands(id),
                FOREIGN KEY (booked_by_user_id) REFERENCES users(id),
                FOREIGN KEY (organization_id) REFERENCES organizations(id),
                UNIQUE(community_name, start_date, island_id)
            )
        """)
        print("✅ Created island_bookings table")
        
        # Create desk_bookings table (updated)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS desk_bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                desk_id INTEGER NOT NULL,
                island_booking_id INTEGER,
                user_id INTEGER NOT NULL,
                organization_id INTEGER NOT NULL,
                booking_date DATE NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                check_in_time TIMESTAMP,
                check_out_time TIMESTAMP,
                status VARCHAR(20) DEFAULT 'confirmed',
                notes TEXT,
                cancellation_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                cancelled_at TIMESTAMP,
                FOREIGN KEY (desk_id) REFERENCES office_desks(id),
                FOREIGN KEY (island_booking_id) REFERENCES island_bookings(id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (organization_id) REFERENCES organizations(id),
                UNIQUE(user_id, booking_date)
            )
        """)
        print("✅ Created desk_bookings table (updated)")
        
        # Create parking_spaces table
        cursor.execute("""
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
                UNIQUE(organization_id, space_number)
            )
        """)
        print("✅ Created parking_spaces table")
        
        # Create parking_bookings table
        cursor.execute("""
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
                UNIQUE(user_id, booking_date)
            )
        """)
        print("✅ Created parking_bookings table")
        
        # Create office_settings table
        cursor.execute("""
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
        """)
        print("✅ Created office_settings table")
        
        # Create indexes for performance
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_desk_islands_org ON desk_islands(organization_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_office_desks_org ON office_desks(organization_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_office_desks_island ON office_desks(island_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_island_bookings_island ON island_bookings(island_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_island_bookings_community ON island_bookings(community_name)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_island_bookings_date ON island_bookings(start_date, end_date)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_desk_bookings_desk ON desk_bookings(desk_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_desk_bookings_user ON desk_bookings(user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_desk_bookings_island ON desk_bookings(island_booking_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_desk_bookings_date ON desk_bookings(booking_date)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_parking_spaces_org ON parking_spaces(organization_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_parking_bookings_space ON parking_bookings(parking_space_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_parking_bookings_user ON parking_bookings(user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_parking_bookings_date ON parking_bookings(booking_date)")
        print("✅ Created performance indexes")
        
        conn.commit()
        print("✅ Migration completed successfully!")
        
    except Exception as e:
        conn.rollback()
        print(f"❌ Migration failed: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    upgrade()
