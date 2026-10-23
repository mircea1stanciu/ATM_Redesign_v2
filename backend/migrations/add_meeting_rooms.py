"""
Migration: Add Meeting Rooms Tables
Creates tables for meeting rooms that can contain multiple desk islands
"""
import os
import sqlite3

# Get the project root directory (two levels up from migrations/)
project_root = os.path.dirname(os.path.dirname(__file__))
db_file = os.path.join(project_root, "unifiedwork.db")
print(f"📂 Using database file: {db_file}")

def migrate():
    """Add meeting rooms tables"""
    print("🔄 Starting migration to add meeting rooms...")
    
    try:
        conn = sqlite3.connect(db_file)
        cursor = conn.cursor()
        
        # Create meeting_rooms table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS meeting_rooms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id INTEGER NOT NULL,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                floor VARCHAR(20),
                building VARCHAR(100),
                location VARCHAR(200),
                capacity INTEGER DEFAULT 0,
                has_projector BOOLEAN DEFAULT 0,
                has_whiteboard BOOLEAN DEFAULT 0,
                has_video_conference BOOLEAN DEFAULT 0,
                has_phone BOOLEAN DEFAULT 0,
                equipment_notes TEXT,
                status VARCHAR(20) DEFAULT 'available' NOT NULL,
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
        print("✅ Created meeting_rooms table")
        
        # Create meeting_room_islands association table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS meeting_room_islands (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_room_id INTEGER NOT NULL,
                island_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (meeting_room_id) REFERENCES meeting_rooms(id) ON DELETE CASCADE,
                FOREIGN KEY (island_id) REFERENCES desk_islands(id) ON DELETE CASCADE,
                UNIQUE(meeting_room_id, island_id)
            )
        """)
        print("✅ Created meeting_room_islands table")
        
        # Create meeting_room_bookings table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS meeting_room_bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_room_id INTEGER NOT NULL,
                booked_by_user_id INTEGER NOT NULL,
                organization_id INTEGER NOT NULL,
                booking_date DATE NOT NULL,
                start_time TIMESTAMP NOT NULL,
                end_time TIMESTAMP NOT NULL,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                attendees_count INTEGER,
                status VARCHAR(20) DEFAULT 'confirmed' NOT NULL,
                notes TEXT,
                cancellation_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                cancelled_at TIMESTAMP,
                FOREIGN KEY (meeting_room_id) REFERENCES meeting_rooms(id) ON DELETE CASCADE,
                FOREIGN KEY (booked_by_user_id) REFERENCES users(id),
                FOREIGN KEY (organization_id) REFERENCES organizations(id),
                UNIQUE(meeting_room_id, start_time)
            )
        """)
        print("✅ Created meeting_room_bookings table")
        
        # Create indexes for performance
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_meeting_rooms_org ON meeting_rooms(organization_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_meeting_room_islands_room ON meeting_room_islands(meeting_room_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_meeting_room_islands_island ON meeting_room_islands(island_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_meeting_room_bookings_room ON meeting_room_bookings(meeting_room_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_meeting_room_bookings_user ON meeting_room_bookings(booked_by_user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_meeting_room_bookings_org ON meeting_room_bookings(organization_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_meeting_room_bookings_date ON meeting_room_bookings(booking_date)")
        print("✅ Created performance indexes")
        
        conn.commit()
        print("✅ Migration completed successfully!")
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
