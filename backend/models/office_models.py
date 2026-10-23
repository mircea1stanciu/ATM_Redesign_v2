"""
Office Management Models
Database models for desk booking and parking space management
Architecture: Islands/Areas -> Individual Desks -> Team Member Bookings
"""
import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from core.database import Base


class DeskIslandStatus(enum.Enum):
    """Desk island/area status"""
    AVAILABLE = "available"
    BOOKED = "booked"
    MAINTENANCE = "maintenance"


class DeskStatus(enum.Enum):
    """Individual desk status within an island"""
    AVAILABLE = "available"
    OCCUPIED = "occupied"
    MAINTENANCE = "maintenance"


class IslandBookingStatus(enum.Enum):
    """Island booking status by community lead"""
    PENDING = "pending"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


class DeskBookingStatus(enum.Enum):
    """Individual desk booking status by team member"""
    PENDING = "pending"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


class ParkingStatus(enum.Enum):
    """Parking space availability status"""
    AVAILABLE = "available"
    OCCUPIED = "occupied"
    MAINTENANCE = "maintenance"
    RESERVED = "reserved"


class BookingStatus(enum.Enum):
    """Booking status"""
    PENDING = "pending"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    COMPLETED = "completed"
    NO_SHOW = "no_show"


class DeskIsland(Base):
    """Desk island/area - a group of desks that can be booked together"""
    __tablename__ = "desk_islands"

    id = Column(Integer, primary_key=True, index=True)
    
    # Organization association
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    
    # Island information
    name = Column(String(100), nullable=False)  # e.g., "North Wing", "Engineering Area"
    description = Column(Text, nullable=True)
    floor = Column(String(20), nullable=True)  # e.g., "2nd Floor"
    building = Column(String(100), nullable=True)  # e.g., "Main Building"
    location = Column(String(200), nullable=True)  # Detailed location description
    
    # Island configuration
    total_desks = Column(Integer, default=0)  # Total number of desks in island
    available_desks = Column(Integer, default=0)  # Number of available desks
    
    # Features of desks in this island
    has_monitors = Column(Boolean, default=False)  # All desks have monitors
    has_docking_stations = Column(Boolean, default=False)
    has_standing_desks = Column(Boolean, default=False)
    
    # Status
    status = Column(Enum(DeskIslandStatus), default=DeskIslandStatus.AVAILABLE, nullable=False)
    is_active = Column(Boolean, default=True)
    is_bookable = Column(Boolean, default=True)
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    # Relationships
    organization = relationship("Organization")
    desks = relationship("OfficeDesk", back_populates="island")
    island_bookings = relationship("IslandBooking", back_populates="island")
    
    # Unique constraint: island name must be unique within organization
    __table_args__ = (
        UniqueConstraint('organization_id', 'name', name='uq_org_island_name'),
    )


class OfficeDesk(Base):
    """Individual desk within an island"""
    __tablename__ = "office_desks"

    id = Column(Integer, primary_key=True, index=True)
    
    # Organization and island association
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    island_id = Column(Integer, ForeignKey("desk_islands.id"), nullable=False, index=True)
    
    # Desk information
    desk_number = Column(String(50), nullable=False)  # e.g., "A-101", "B-205"
    position_in_island = Column(Integer, nullable=True)  # e.g., 1, 2, 3 for ordering
    
    # Desk details (can override island settings)
    description = Column(Text, nullable=True)
    has_monitor = Column(Boolean, default=False)
    has_docking_station = Column(Boolean, default=False)
    has_standing_desk = Column(Boolean, default=False)
    equipment_notes = Column(Text, nullable=True)
    
    # Status and availability
    status = Column(Enum(DeskStatus), default=DeskStatus.AVAILABLE, nullable=False)
    is_active = Column(Boolean, default=True)
    is_bookable = Column(Boolean, default=True)
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    # Relationships
    organization = relationship("Organization")
    island = relationship("DeskIsland", back_populates="desks")
    bookings = relationship("DeskBooking", back_populates="desk")
    
    # Unique constraint: desk number must be unique within organization
    __table_args__ = (
        UniqueConstraint('organization_id', 'desk_number', name='uq_org_desk_number'),
    )


class ParkingSpace(Base):
    """Parking space resource"""
    __tablename__ = "parking_spaces"

    id = Column(Integer, primary_key=True, index=True)
    
    # Organization association
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    
    # Parking information
    space_number = Column(String(50), nullable=False)  # e.g., "P1", "A-25"
    level = Column(String(20), nullable=True)  # e.g., "Level 1", "Underground"
    location = Column(String(100), nullable=True)  # e.g., "Near elevator", "Section A"
    building = Column(String(100), nullable=True)  # e.g., "Main Building"
    
    # Space details
    description = Column(Text, nullable=True)  # e.g., "Covered parking, EV charging"
    is_covered = Column(Boolean, default=False)
    has_ev_charging = Column(Boolean, default=False)
    is_handicap = Column(Boolean, default=False)
    space_type = Column(String(50), nullable=True)  # e.g., "Standard", "Compact", "SUV"
    
    # Status and availability
    status = Column(Enum(ParkingStatus), default=ParkingStatus.AVAILABLE, nullable=False)
    is_active = Column(Boolean, default=True)  # Can be disabled by admin
    is_bookable = Column(Boolean, default=True)  # Can users book this space
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    # Relationships
    organization = relationship("Organization")
    bookings = relationship("ParkingBooking", back_populates="parking_space")
    
    # Unique constraint: space number must be unique within organization
    __table_args__ = (
        UniqueConstraint('organization_id', 'space_number', name='uq_org_space_number'),
    )


class IslandBooking(Base):
    """Island booking by community lead for their team"""
    __tablename__ = "island_bookings"

    id = Column(Integer, primary_key=True, index=True)
    
    # Relationships
    island_id = Column(Integer, ForeignKey("desk_islands.id"), nullable=False, index=True)
    community_name = Column(String, nullable=False, index=True)  # Community name (qa, backend, frontend, etc.)
    booked_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)  # Community lead
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    
    # Booking details
    booking_date = Column(Date, nullable=False, index=True)  # Date for the booking
    start_date = Column(Date, nullable=False)  # Can book for multiple days
    end_date = Column(Date, nullable=False)
    
    # Booking info
    team_size = Column(Integer, nullable=True)  # Expected number of team members
    status = Column(Enum(IslandBookingStatus), default=IslandBookingStatus.CONFIRMED, nullable=False)
    notes = Column(Text, nullable=True)
    cancellation_reason = Column(Text, nullable=True)
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    cancelled_at = Column(DateTime, nullable=True)
    
    # Relationships
    island = relationship("DeskIsland", back_populates="island_bookings")
    booked_by_user = relationship("User")
    organization = relationship("Organization")
    desk_bookings = relationship("DeskBooking", back_populates="island_booking")
    
    # Unique constraint: one community can only book one island per day
    __table_args__ = (
        UniqueConstraint('community_name', 'start_date', 'island_id', name='uq_community_island_per_day'),
    )


class DeskBooking(Base):
    """Individual desk booking by team member within an island booking"""
    __tablename__ = "desk_bookings"

    id = Column(Integer, primary_key=True, index=True)
    
    # Relationships
    desk_id = Column(Integer, ForeignKey("office_desks.id"), nullable=False, index=True)
    island_booking_id = Column(
        Integer, ForeignKey("island_bookings.id"), nullable=True, index=True
    )  # Parent island booking
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    
    # Booking details
    booking_date = Column(Date, nullable=False, index=True)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    
    # Check-in/out tracking
    check_in_time = Column(DateTime, nullable=True)
    check_out_time = Column(DateTime, nullable=True)
    
    # Booking status
    status = Column(Enum(DeskBookingStatus), default=DeskBookingStatus.CONFIRMED, nullable=False)
    
    # Notes
    notes = Column(Text, nullable=True)
    cancellation_reason = Column(Text, nullable=True)
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    cancelled_at = Column(DateTime, nullable=True)
    
    # Relationships
    desk = relationship("OfficeDesk", back_populates="bookings")
    user = relationship("User")
    organization = relationship("Organization")
    island_booking = relationship("IslandBooking", back_populates="desk_bookings")
    
    # Unique constraint: one user can only book one desk per day
    __table_args__ = (
        UniqueConstraint('user_id', 'booking_date', name='uq_user_desk_per_day'),
    )


class ParkingBooking(Base):
    """Parking space booking record"""
    __tablename__ = "parking_bookings"

    id = Column(Integer, primary_key=True, index=True)
    
    # Relationships
    parking_space_id = Column(Integer, ForeignKey("parking_spaces.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    
    # Booking details
    booking_date = Column(Date, nullable=False, index=True)  # Date for the booking
    vehicle_plate = Column(String(20), nullable=True)  # Optional vehicle plate number
    check_in_time = Column(DateTime, nullable=True)  # Actual arrival
    check_out_time = Column(DateTime, nullable=True)  # Actual departure
    
    # Booking status
    status = Column(Enum(BookingStatus), default=BookingStatus.CONFIRMED, nullable=False)
    
    # Notes
    notes = Column(Text, nullable=True)  # User notes for the booking
    cancellation_reason = Column(Text, nullable=True)  # Reason if cancelled
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    cancelled_at = Column(DateTime, nullable=True)
    
    # Relationships
    parking_space = relationship("ParkingSpace", back_populates="bookings")
    user = relationship("User")
    organization = relationship("Organization")
    
    # Unique constraint: one user can only book one parking space per day
    __table_args__ = (
        UniqueConstraint('user_id', 'booking_date', name='uq_user_parking_per_day'),
    )


class MeetingRoomStatus(enum.Enum):
    """Meeting room availability status"""
    AVAILABLE = "available"
    BOOKED = "booked"
    MAINTENANCE = "maintenance"


class MeetingRoom(Base):
    """Meeting room that can contain multiple desk islands"""
    __tablename__ = "meeting_rooms"

    id = Column(Integer, primary_key=True, index=True)
    
    # Organization association
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    
    # Room information
    name = Column(String(100), nullable=False)  # e.g., "Conference Room A", "Team Room 1"
    description = Column(Text, nullable=True)
    floor = Column(String(20), nullable=True)  # e.g., "2nd Floor"
    building = Column(String(100), nullable=True)  # e.g., "Main Building"
    location = Column(String(200), nullable=True)  # Detailed location description
    
    # Room capacity and features
    capacity = Column(Integer, default=0)  # Maximum number of people
    has_projector = Column(Boolean, default=False)
    has_whiteboard = Column(Boolean, default=False)
    has_video_conference = Column(Boolean, default=False)
    has_phone = Column(Boolean, default=False)
    equipment_notes = Column(Text, nullable=True)
    
    # Status
    status = Column(Enum(MeetingRoomStatus), default=MeetingRoomStatus.AVAILABLE, nullable=False)
    is_active = Column(Boolean, default=True)
    is_bookable = Column(Boolean, default=True)
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    # Relationships
    organization = relationship("Organization")
    islands = relationship("MeetingRoomIsland", back_populates="meeting_room")
    bookings = relationship("MeetingRoomBooking", back_populates="meeting_room")
    
    # Unique constraint: room name must be unique within organization
    __table_args__ = (
        UniqueConstraint('organization_id', 'name', name='uq_org_meeting_room_name'),
    )


class MeetingRoomIsland(Base):
    """Association table for meeting rooms and desk islands"""
    __tablename__ = "meeting_room_islands"

    id = Column(Integer, primary_key=True, index=True)
    meeting_room_id = Column(Integer, ForeignKey("meeting_rooms.id"), nullable=False, index=True)
    island_id = Column(Integer, ForeignKey("desk_islands.id"), nullable=False, index=True)
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    meeting_room = relationship("MeetingRoom", back_populates="islands")
    island = relationship("DeskIsland")
    
    # Unique constraint: each island can only be in one meeting room
    __table_args__ = (
        UniqueConstraint('meeting_room_id', 'island_id', name='uq_meeting_room_island'),
    )


class MeetingRoomBookingStatus(enum.Enum):
    """Meeting room booking status"""
    PENDING = "pending"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


class MeetingRoomBooking(Base):
    """Meeting room booking record"""
    __tablename__ = "meeting_room_bookings"

    id = Column(Integer, primary_key=True, index=True)
    
    # Relationships
    meeting_room_id = Column(Integer, ForeignKey("meeting_rooms.id"), nullable=False, index=True)
    booked_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    
    # Booking details
    booking_date = Column(Date, nullable=False, index=True)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    
    # Booking information
    title = Column(String(200), nullable=False)  # Meeting title
    description = Column(Text, nullable=True)
    attendees_count = Column(Integer, nullable=True)
    status = Column(Enum(MeetingRoomBookingStatus), default=MeetingRoomBookingStatus.CONFIRMED, nullable=False)
    
    # Notes
    notes = Column(Text, nullable=True)
    cancellation_reason = Column(Text, nullable=True)
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    cancelled_at = Column(DateTime, nullable=True)
    
    # Relationships
    meeting_room = relationship("MeetingRoom", back_populates="bookings")
    booked_by_user = relationship("User")
    organization = relationship("Organization")
    
    # Constraint: prevent overlapping bookings
    __table_args__ = (
        UniqueConstraint('meeting_room_id', 'start_time', name='uq_meeting_room_time'),
    )


class OfficeSettings(Base):
    """Office management settings per organization"""
    __tablename__ = "office_settings"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, unique=True, index=True)
    
    # Booking rules
    allow_desk_booking = Column(Boolean, default=True)
    allow_parking_booking = Column(Boolean, default=True)
    advance_booking_days = Column(Integer, default=14)  # How many days in advance can users book
    booking_deadline_hour = Column(Integer, default=22)  # Last hour to book for next day (22 = 10 PM)
    allow_same_day_booking = Column(Boolean, default=True)
    
    # Cancellation rules
    allow_cancellation = Column(Boolean, default=True)
    cancellation_deadline_hours = Column(Integer, default=12)  # Hours before booking to allow cancellation
    
    # Desk settings
    require_desk_check_in = Column(Boolean, default=False)  # Require check-in to confirm usage
    auto_release_desk_minutes = Column(Integer, default=30)  # Release desk if no check-in after X minutes
    
    # Parking settings
    require_parking_check_in = Column(Boolean, default=False)
    require_vehicle_plate = Column(Boolean, default=False)  # Make vehicle plate mandatory
    
    # Notifications
    send_booking_confirmation = Column(Boolean, default=True)
    send_reminder_email = Column(Boolean, default=True)
    reminder_hours_before = Column(Integer, default=24)  # Send reminder X hours before
    
    # Office hours
    office_start_hour = Column(Integer, default=8)  # Office opens at 8 AM
    office_end_hour = Column(Integer, default=18)  # Office closes at 6 PM
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    organization = relationship("Organization")
