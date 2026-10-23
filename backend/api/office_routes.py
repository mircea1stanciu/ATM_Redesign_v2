"""
Island-Based Office Management API Routes
Endpoints for managing desk islands, desk bookings, and parking spaces
"""
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, joinedload

from core.auth import get_current_user, get_org_admin_user
from core.database import User, get_db
from models.office_models import (
    DeskBooking,
    DeskBookingStatus,
    DeskIsland,
    IslandBooking,
    IslandBookingStatus,
    MeetingRoom,
    MeetingRoomBooking,
    MeetingRoomBookingStatus,
    MeetingRoomIsland,
    MeetingRoomStatus,
    OfficeDesk,
    ParkingSpace,
)

router = APIRouter(prefix="/api/office", tags=["Office Management"])


# ==================== Pydantic Schemas ====================

# Island Schemas
class DeskIslandCreate(BaseModel):
    name: str
    description: Optional[str] = None
    floor: Optional[str] = None
    building: Optional[str] = None
    location: Optional[str] = None
    has_monitors: bool = False
    has_docking_stations: bool = False
    has_standing_desks: bool = False
    is_bookable: bool = True


class DeskIslandUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    floor: Optional[str] = None
    building: Optional[str] = None
    location: Optional[str] = None
    has_monitors: Optional[bool] = None
    has_docking_stations: Optional[bool] = None
    has_standing_desks: Optional[bool] = None
    status: Optional[str] = None
    is_bookable: Optional[bool] = None


class DeskIslandResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    floor: Optional[str]
    building: Optional[str]
    location: Optional[str]
    total_desks: int
    available_desks: int
    has_monitors: bool
    has_docking_stations: bool
    has_standing_desks: bool
    status: str
    is_active: bool
    is_bookable: bool
    created_at: datetime

    class Config:
        from_attributes = True


# Desk Schemas
class OfficeDeskCreate(BaseModel):
    desk_number: str
    position_in_island: Optional[int] = None
    description: Optional[str] = None
    has_monitor: bool = False
    has_docking_station: bool = False
    has_standing_desk: bool = False
    is_bookable: bool = True


class OfficeDeskResponse(BaseModel):
    id: int
    island_id: int
    desk_number: str
    position_in_island: Optional[int]
    has_monitor: bool
    has_docking_station: bool
    has_standing_desk: bool
    status: str
    is_active: bool
    is_bookable: bool

    class Config:
        from_attributes = True


# Island Booking Schemas
class IslandBookingCreate(BaseModel):
    island_id: int
    start_date: date
    end_date: date
    team_size: Optional[int] = None
    notes: Optional[str] = None


class IslandBookingResponse(BaseModel):
    id: int
    island_id: int
    community_name: str
    booked_by_user_id: int
    start_date: date
    end_date: date
    team_size: Optional[int]
    status: str
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# Desk Booking Schemas
class DeskBookingCreate(BaseModel):
    desk_id: int
    island_booking_id: Optional[int] = None
    start_date: date
    end_date: date
    notes: Optional[str] = None


class DeskBookingResponse(BaseModel):
    id: int
    desk_id: int
    island_booking_id: Optional[int]
    user_id: int
    start_date: date
    end_date: date
    check_in_time: Optional[datetime]
    check_out_time: Optional[datetime]
    status: str
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# Parking Schemas
class ParkingSpaceCreate(BaseModel):
    space_number: str
    level: Optional[str] = None
    location: Optional[str] = None
    building: Optional[str] = None
    is_covered: bool = False
    has_ev_charging: bool = False
    is_handicap: bool = False
    is_bookable: bool = True


class ParkingSpaceResponse(BaseModel):
    id: int
    space_number: str
    level: Optional[str]
    location: Optional[str]
    building: Optional[str]
    is_covered: bool
    has_ev_charging: bool
    is_handicap: bool
    status: str
    is_active: bool
    is_bookable: bool

    class Config:
        from_attributes = True


# Meeting Room Schemas
class MeetingRoomCreate(BaseModel):
    name: str
    description: Optional[str] = None
    floor: Optional[str] = None
    building: Optional[str] = None
    location: Optional[str] = None
    capacity: int = 0
    has_projector: bool = False
    has_whiteboard: bool = False
    has_video_conference: bool = False
    has_phone: bool = False
    equipment_notes: Optional[str] = None
    island_ids: list[int] = []  # List of island IDs to include in the room


class MeetingRoomUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    floor: Optional[str] = None
    building: Optional[str] = None
    location: Optional[str] = None
    capacity: Optional[int] = None
    has_projector: Optional[bool] = None
    has_whiteboard: Optional[bool] = None
    has_video_conference: Optional[bool] = None
    has_phone: Optional[bool] = None
    equipment_notes: Optional[str] = None
    status: Optional[str] = None
    is_bookable: Optional[bool] = None
    island_ids: Optional[list[int]] = None


class MeetingRoomIslandResponse(BaseModel):
    id: int
    name: str
    total_desks: int
    
    class Config:
        from_attributes = True


class MeetingRoomResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    floor: Optional[str]
    building: Optional[str]
    location: Optional[str]
    capacity: int
    has_projector: bool
    has_whiteboard: bool
    has_video_conference: bool
    has_phone: bool
    equipment_notes: Optional[str]
    status: str
    is_active: bool
    is_bookable: bool
    created_at: datetime
    islands: list[MeetingRoomIslandResponse] = []
    
    class Config:
        from_attributes = True


class MeetingRoomBookingCreate(BaseModel):
    meeting_room_id: int
    booking_date: date
    start_time: datetime
    end_time: datetime
    title: str
    description: Optional[str] = None
    attendees_count: Optional[int] = None
    notes: Optional[str] = None


class MeetingRoomBookingResponse(BaseModel):
    id: int
    meeting_room_id: int
    booking_date: date
    start_time: datetime
    end_time: datetime
    title: str
    description: Optional[str]
    attendees_count: Optional[int]
    status: str
    notes: Optional[str]
    created_at: datetime
    
    class Config:
        from_attributes = True


# ==================== Island Management (Org Admin) ====================

@router.post("/islands", response_model=DeskIslandResponse)
async def create_island(
    island_data: DeskIslandCreate,
    current_user: User = Depends(get_org_admin_user),
    db: Session = Depends(get_db)
):
    """Create a new desk island (Org Admin only)"""
    if not current_user.organization_id:
        raise HTTPException(status_code=400, detail="User not associated with an organization")

    # Check if island name already exists
    existing = db.query(DeskIsland).filter(
        and_(
            DeskIsland.organization_id == current_user.organization_id,
            DeskIsland.name == island_data.name
        )
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Island with this name already exists")

    new_island = DeskIsland(
        organization_id=current_user.organization_id,
        name=island_data.name,
        description=island_data.description,
        floor=island_data.floor,
        building=island_data.building,
        location=island_data.location,
        has_monitors=island_data.has_monitors,
        has_docking_stations=island_data.has_docking_stations,
        has_standing_desks=island_data.has_standing_desks,
        is_bookable=island_data.is_bookable,
        created_by_user_id=current_user.id
    )

    db.add(new_island)
    db.commit()
    db.refresh(new_island)
    return new_island


@router.get("/islands", response_model=list[DeskIslandResponse])
async def list_islands(
    current_user: User = Depends(get_org_admin_user),
    db: Session = Depends(get_db)
):
    """List all desk islands for organization (Org Admin only)"""
    if not current_user.organization_id:
        raise HTTPException(status_code=400, detail="User not associated with an organization")

    islands = db.query(DeskIsland).filter(
        DeskIsland.organization_id == current_user.organization_id
    ).all()

    return islands


@router.get("/islands/{island_id}", response_model=DeskIslandResponse)
async def get_island(
    island_id: int,
    current_user: User = Depends(get_org_admin_user),
    db: Session = Depends(get_db)
):
    """Get island details"""
    island = db.query(DeskIsland).filter(DeskIsland.id == island_id).first()
    if not island:
        raise HTTPException(status_code=404, detail="Island not found")

    if island.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return island


@router.patch("/islands/{island_id}", response_model=DeskIslandResponse)
async def update_island(
    island_id: int,
    island_data: DeskIslandUpdate,
    current_user: User = Depends(get_org_admin_user),
    db: Session = Depends(get_db)
):
    """Update island details"""
    island = db.query(DeskIsland).filter(DeskIsland.id == island_id).first()
    if not island:
        raise HTTPException(status_code=404, detail="Island not found")

    if island.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Update fields
    for field, value in island_data.model_dump(exclude_unset=True).items():
        if hasattr(island, field):
            setattr(island, field, value)

    island.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(island)
    return island


@router.delete("/islands/{island_id}")
async def delete_island(
    island_id: int,
    current_user: User = Depends(get_org_admin_user),
    db: Session = Depends(get_db)
):
    """Delete island (and all associated desks)"""
    island = db.query(DeskIsland).filter(DeskIsland.id == island_id).first()
    if not island:
        raise HTTPException(status_code=404, detail="Island not found")

    if island.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Delete all desks in island
    db.query(OfficeDesk).filter(OfficeDesk.island_id == island_id).delete()

    # Delete island
    db.delete(island)
    db.commit()

    return {"message": "Island deleted successfully"}


# ==================== Desk Management (Org Admin) ====================

@router.post("/islands/{island_id}/desks", response_model=OfficeDeskResponse)
async def create_desk(
    island_id: int,
    desk_data: OfficeDeskCreate,
    current_user: User = Depends(get_org_admin_user),
    db: Session = Depends(get_db)
):
    """Add desk to island"""
    island = db.query(DeskIsland).filter(DeskIsland.id == island_id).first()
    if not island:
        raise HTTPException(status_code=404, detail="Island not found")

    if island.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Check if desk number already exists
    existing = db.query(OfficeDesk).filter(
        and_(
            OfficeDesk.organization_id == current_user.organization_id,
            OfficeDesk.desk_number == desk_data.desk_number
        )
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Desk with this number already exists")

    new_desk = OfficeDesk(
        organization_id=current_user.organization_id,
        island_id=island_id,
        desk_number=desk_data.desk_number,
        position_in_island=desk_data.position_in_island,
        description=desk_data.description,
        has_monitor=desk_data.has_monitor,
        has_docking_station=desk_data.has_docking_station,
        has_standing_desk=desk_data.has_standing_desk,
        is_bookable=desk_data.is_bookable,
        created_by_user_id=current_user.id
    )

    db.add(new_desk)

    # Update island desk count
    island.total_desks = (island.total_desks or 0) + 1
    island.available_desks = (island.available_desks or 0) + 1

    db.commit()
    db.refresh(new_desk)
    return new_desk


@router.get("/islands/{island_id}/desks")
async def list_island_desks(
    island_id: int,
    current_user: User = Depends(get_org_admin_user),
    db: Session = Depends(get_db)
):
    """List desks in an island"""
    island = db.query(DeskIsland).filter(DeskIsland.id == island_id).first()
    if not island:
        raise HTTPException(status_code=404, detail="Island not found")

    if island.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")

    desks = db.query(OfficeDesk).filter(
        OfficeDesk.island_id == island_id
    ).order_by(OfficeDesk.position_in_island).all()

    return desks


@router.delete("/desks/{desk_id}")
async def delete_desk(
    desk_id: int,
    current_user: User = Depends(get_org_admin_user),
    db: Session = Depends(get_db)
):
    """Delete desk"""
    desk = db.query(OfficeDesk).filter(OfficeDesk.id == desk_id).first()
    if not desk:
        raise HTTPException(status_code=404, detail="Desk not found")

    if desk.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")

    island = db.query(DeskIsland).filter(DeskIsland.id == desk.island_id).first()
    if island:
        island.total_desks = max(0, (island.total_desks or 1) - 1)
        island.available_desks = max(0, (island.available_desks or 1) - 1)

    db.delete(desk)
    db.commit()

    return {"message": "Desk deleted successfully"}


# ==================== Island Bookings (Community Lead) ====================

@router.post("/island-bookings", response_model=IslandBookingResponse)
async def book_island(
    booking_data: IslandBookingCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Book an island for team (Community Lead)"""
    if not current_user.organization_id:
        raise HTTPException(status_code=400, detail="User not associated with organization")

    island = db.query(DeskIsland).filter(DeskIsland.id == booking_data.island_id).first()
    if not island:
        raise HTTPException(status_code=404, detail="Island not found")

    if island.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Use a default community name if not provided
    community_name = "default"

    # Check for conflicts
    existing_booking = db.query(IslandBooking).filter(
        and_(
            IslandBooking.island_id == booking_data.island_id,
            IslandBooking.community_name == community_name,
            IslandBooking.start_date <= booking_data.end_date,
            IslandBooking.end_date >= booking_data.start_date,
            IslandBooking.status != IslandBookingStatus.CANCELLED
        )
    ).first()

    if existing_booking:
        raise HTTPException(status_code=400, detail="Island already booked for this period")

    new_booking = IslandBooking(
        island_id=booking_data.island_id,
        community_name=community_name,
        booked_by_user_id=current_user.id,
        organization_id=current_user.organization_id,
        booking_date=date.today(),
        start_date=booking_data.start_date,
        end_date=booking_data.end_date,
        team_size=booking_data.team_size,
        notes=booking_data.notes,
        status=IslandBookingStatus.CONFIRMED
    )

    db.add(new_booking)
    db.commit()
    db.refresh(new_booking)
    return new_booking


@router.get("/island-bookings", response_model=list[IslandBookingResponse])
async def list_island_bookings(
    current_user: User = Depends(get_org_admin_user),
    db: Session = Depends(get_db),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None)
):
    """List all island bookings for organization"""
    if not current_user.organization_id:
        raise HTTPException(status_code=400, detail="User not associated with an organization")

    if not start_date:
        start_date = date.today()
    if not end_date:
        end_date = start_date + timedelta(days=30)

    bookings = db.query(IslandBooking).options(
        joinedload(IslandBooking.island)
    ).filter(
        and_(
            IslandBooking.organization_id == current_user.organization_id,
            IslandBooking.start_date >= start_date,
            IslandBooking.start_date <= end_date
        )
    ).order_by(IslandBooking.start_date.desc()).all()

    return bookings


@router.delete("/island-bookings/{booking_id}")
async def cancel_island_booking(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Cancel island booking"""
    booking = db.query(IslandBooking).filter(IslandBooking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    if booking.booked_by_user_id != current_user.id and current_user.role != "org_admin":
        raise HTTPException(status_code=403, detail="Access denied")

    booking.status = IslandBookingStatus.CANCELLED
    booking.cancelled_at = datetime.utcnow()

    db.commit()
    return {"message": "Island booking cancelled"}


# ==================== Desk Bookings (Team Members) ====================

@router.post("/desk-bookings", response_model=DeskBookingResponse)
async def book_desk(
    booking_data: DeskBookingCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Book a desk"""
    desk = db.query(OfficeDesk).filter(OfficeDesk.id == booking_data.desk_id).first()
    if not desk:
        raise HTTPException(status_code=404, detail="Desk not found")

    if desk.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Check for existing booking on same date
    existing_booking = db.query(DeskBooking).filter(
        and_(
            DeskBooking.user_id == current_user.id,
            DeskBooking.booking_date == booking_data.start_date,
            DeskBooking.status != DeskBookingStatus.CANCELLED
        )
    ).first()

    if existing_booking:
        raise HTTPException(status_code=400, detail="You already have a desk booking for this date")

    # Check desk availability
    desk_conflict = db.query(DeskBooking).filter(
        and_(
            DeskBooking.desk_id == booking_data.desk_id,
            DeskBooking.start_date <= booking_data.end_date,
            DeskBooking.end_date >= booking_data.start_date,
            DeskBooking.status != DeskBookingStatus.CANCELLED
        )
    ).first()

    if desk_conflict:
        raise HTTPException(status_code=400, detail="Desk not available for this period")

    new_booking = DeskBooking(
        desk_id=booking_data.desk_id,
        island_booking_id=booking_data.island_booking_id,
        user_id=current_user.id,
        organization_id=current_user.organization_id,
        booking_date=booking_data.start_date,
        start_date=booking_data.start_date,
        end_date=booking_data.end_date,
        notes=booking_data.notes,
        status=DeskBookingStatus.CONFIRMED
    )

    db.add(new_booking)
    db.commit()
    db.refresh(new_booking)
    return new_booking


@router.get("/desk-bookings/my-bookings", response_model=list[DeskBookingResponse])
async def get_my_desk_bookings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get user's desk bookings"""
    bookings = db.query(DeskBooking).options(
        joinedload(DeskBooking.desk)
    ).filter(
        DeskBooking.user_id == current_user.id
    ).order_by(DeskBooking.start_date.desc()).all()

    return bookings


@router.delete("/desk-bookings/{booking_id}")
async def cancel_desk_booking(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Cancel desk booking"""
    booking = db.query(DeskBooking).filter(DeskBooking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    if booking.user_id != current_user.id and current_user.role != "org_admin":
        raise HTTPException(status_code=403, detail="Access denied")

    booking.status = DeskBookingStatus.CANCELLED
    booking.cancelled_at = datetime.utcnow()

    db.commit()
    return {"message": "Desk booking cancelled"}


# ==================== Parking Management ====================

@router.post("/parking", response_model=ParkingSpaceResponse)
async def create_parking_space(
    parking_data: ParkingSpaceCreate,
    current_user: User = Depends(get_org_admin_user),
    db: Session = Depends(get_db)
):
    """Create parking space (Org Admin only)"""
    if not current_user.organization_id:
        raise HTTPException(status_code=400, detail="User not associated with an organization")

    # Check if space number already exists
    existing = db.query(ParkingSpace).filter(
        and_(
            ParkingSpace.organization_id == current_user.organization_id,
            ParkingSpace.space_number == parking_data.space_number
        )
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Parking space with this number already exists")

    new_space = ParkingSpace(
        organization_id=current_user.organization_id,
        space_number=parking_data.space_number,
        level=parking_data.level,
        location=parking_data.location,
        building=parking_data.building,
        is_covered=parking_data.is_covered,
        has_ev_charging=parking_data.has_ev_charging,
        is_handicap=parking_data.is_handicap,
        is_bookable=parking_data.is_bookable,
        created_by_user_id=current_user.id
    )

    db.add(new_space)
    db.commit()
    db.refresh(new_space)
    return new_space


@router.get("/parking", response_model=list[ParkingSpaceResponse])
async def list_parking_spaces(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List parking spaces"""
    if not current_user.organization_id:
        raise HTTPException(status_code=400, detail="User not associated with an organization")

    spaces = db.query(ParkingSpace).filter(
        ParkingSpace.organization_id == current_user.organization_id
    ).all()

    return spaces


@router.delete("/parking/{space_id}")
async def delete_parking_space(
    space_id: int,
    current_user: User = Depends(get_org_admin_user),
    db: Session = Depends(get_db)
):
    """Delete parking space"""
    space = db.query(ParkingSpace).filter(ParkingSpace.id == space_id).first()
    if not space:
        raise HTTPException(status_code=404, detail="Parking space not found")

    if space.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")

    db.delete(space)
    db.commit()

    return {"message": "Parking space deleted successfully"}


# ==================== Meeting Room Endpoints ====================

@router.post("/meeting-rooms", response_model=MeetingRoomResponse)
async def create_meeting_room(
    room: MeetingRoomCreate,
    current_user: User = Depends(get_org_admin_user),
    db: Session = Depends(get_db)
):
    """Create a new meeting room (org admin only)"""
    if not current_user.organization_id:
        raise HTTPException(status_code=400, detail="User not associated with an organization")

    # Check if room name already exists
    existing = db.query(MeetingRoom).filter(
        MeetingRoom.organization_id == current_user.organization_id,
        MeetingRoom.name == room.name
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="Meeting room with this name already exists")

    # Verify all islands exist and belong to the organization
    if room.island_ids:
        islands = db.query(DeskIsland).filter(
            DeskIsland.id.in_(room.island_ids),
            DeskIsland.organization_id == current_user.organization_id
        ).all()
        
        if len(islands) != len(room.island_ids):
            raise HTTPException(status_code=400, detail="One or more islands not found")

    # Create meeting room
    new_room = MeetingRoom(
        organization_id=current_user.organization_id,
        name=room.name,
        description=room.description,
        floor=room.floor,
        building=room.building,
        location=room.location,
        capacity=room.capacity,
        has_projector=room.has_projector,
        has_whiteboard=room.has_whiteboard,
        has_video_conference=room.has_video_conference,
        has_phone=room.has_phone,
        equipment_notes=room.equipment_notes,
        created_by_user_id=current_user.id
    )
    
    db.add(new_room)
    db.commit()
    db.refresh(new_room)

    # Add islands to the meeting room
    if room.island_ids:
        for island_id in room.island_ids:
            room_island = MeetingRoomIsland(
                meeting_room_id=new_room.id,
                island_id=island_id
            )
            db.add(room_island)
        db.commit()

    # Fetch room with islands
    room_with_islands = db.query(MeetingRoom).options(
        joinedload(MeetingRoom.islands).joinedload(MeetingRoomIsland.island)
    ).filter(MeetingRoom.id == new_room.id).first()

    # Format response
    response = MeetingRoomResponse(
        id=room_with_islands.id,
        name=room_with_islands.name,
        description=room_with_islands.description,
        floor=room_with_islands.floor,
        building=room_with_islands.building,
        location=room_with_islands.location,
        capacity=room_with_islands.capacity,
        has_projector=room_with_islands.has_projector,
        has_whiteboard=room_with_islands.has_whiteboard,
        has_video_conference=room_with_islands.has_video_conference,
        has_phone=room_with_islands.has_phone,
        equipment_notes=room_with_islands.equipment_notes,
        status=room_with_islands.status.value,
        is_active=room_with_islands.is_active,
        is_bookable=room_with_islands.is_bookable,
        created_at=room_with_islands.created_at,
        islands=[
            MeetingRoomIslandResponse(
                id=ri.island.id,
                name=ri.island.name,
                total_desks=ri.island.total_desks
            )
            for ri in room_with_islands.islands
        ]
    )

    return response


@router.get("/meeting-rooms", response_model=list[MeetingRoomResponse])
async def list_meeting_rooms(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all meeting rooms"""
    if not current_user.organization_id:
        raise HTTPException(status_code=400, detail="User not associated with an organization")

    rooms = db.query(MeetingRoom).options(
        joinedload(MeetingRoom.islands).joinedload(MeetingRoomIsland.island)
    ).filter(
        MeetingRoom.organization_id == current_user.organization_id
    ).all()

    response = []
    for room in rooms:
        response.append(MeetingRoomResponse(
            id=room.id,
            name=room.name,
            description=room.description,
            floor=room.floor,
            building=room.building,
            location=room.location,
            capacity=room.capacity,
            has_projector=room.has_projector,
            has_whiteboard=room.has_whiteboard,
            has_video_conference=room.has_video_conference,
            has_phone=room.has_phone,
            equipment_notes=room.equipment_notes,
            status=room.status.value,
            is_active=room.is_active,
            is_bookable=room.is_bookable,
            created_at=room.created_at,
            islands=[
                MeetingRoomIslandResponse(
                    id=ri.island.id,
                    name=ri.island.name,
                    total_desks=ri.island.total_desks
                )
                for ri in room.islands
            ]
        ))

    return response


@router.get("/meeting-rooms/{room_id}", response_model=MeetingRoomResponse)
async def get_meeting_room(
    room_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get meeting room details"""
    room = db.query(MeetingRoom).options(
        joinedload(MeetingRoom.islands).joinedload(MeetingRoomIsland.island)
    ).filter(MeetingRoom.id == room_id).first()
    
    if not room:
        raise HTTPException(status_code=404, detail="Meeting room not found")
    
    if room.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return MeetingRoomResponse(
        id=room.id,
        name=room.name,
        description=room.description,
        floor=room.floor,
        building=room.building,
        location=room.location,
        capacity=room.capacity,
        has_projector=room.has_projector,
        has_whiteboard=room.has_whiteboard,
        has_video_conference=room.has_video_conference,
        has_phone=room.has_phone,
        equipment_notes=room.equipment_notes,
        status=room.status.value,
        is_active=room.is_active,
        is_bookable=room.is_bookable,
        created_at=room.created_at,
        islands=[
            MeetingRoomIslandResponse(
                id=ri.island.id,
                name=ri.island.name,
                total_desks=ri.island.total_desks
            )
            for ri in room.islands
        ]
    )


@router.patch("/meeting-rooms/{room_id}", response_model=MeetingRoomResponse)
async def update_meeting_room(
    room_id: int,
    room_update: MeetingRoomUpdate,
    current_user: User = Depends(get_org_admin_user),
    db: Session = Depends(get_db)
):
    """Update meeting room"""
    room = db.query(MeetingRoom).filter(MeetingRoom.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Meeting room not found")

    if room.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Update fields
    update_data = room_update.dict(exclude_unset=True)
    island_ids = update_data.pop('island_ids', None)
    
    for field, value in update_data.items():
        if field == 'status':
            setattr(room, field, MeetingRoomStatus(value))
        else:
            setattr(room, field, value)

    # Update islands if provided
    if island_ids is not None:
        # Verify islands exist
        if island_ids:
            islands = db.query(DeskIsland).filter(
                DeskIsland.id.in_(island_ids),
                DeskIsland.organization_id == current_user.organization_id
            ).all()
            
            if len(islands) != len(island_ids):
                raise HTTPException(status_code=400, detail="One or more islands not found")

        # Remove existing associations
        db.query(MeetingRoomIsland).filter(
            MeetingRoomIsland.meeting_room_id == room_id
        ).delete()

        # Add new associations
        for island_id in island_ids:
            room_island = MeetingRoomIsland(
                meeting_room_id=room_id,
                island_id=island_id
            )
            db.add(room_island)

    db.commit()
    db.refresh(room)

    # Fetch updated room with islands
    room_with_islands = db.query(MeetingRoom).options(
        joinedload(MeetingRoom.islands).joinedload(MeetingRoomIsland.island)
    ).filter(MeetingRoom.id == room_id).first()

    return MeetingRoomResponse(
        id=room_with_islands.id,
        name=room_with_islands.name,
        description=room_with_islands.description,
        floor=room_with_islands.floor,
        building=room_with_islands.building,
        location=room_with_islands.location,
        capacity=room_with_islands.capacity,
        has_projector=room_with_islands.has_projector,
        has_whiteboard=room_with_islands.has_whiteboard,
        has_video_conference=room_with_islands.has_video_conference,
        has_phone=room_with_islands.has_phone,
        equipment_notes=room_with_islands.equipment_notes,
        status=room_with_islands.status.value,
        is_active=room_with_islands.is_active,
        is_bookable=room_with_islands.is_bookable,
        created_at=room_with_islands.created_at,
        islands=[
            MeetingRoomIslandResponse(
                id=ri.island.id,
                name=ri.island.name,
                total_desks=ri.island.total_desks
            )
            for ri in room_with_islands.islands
        ]
    )


@router.delete("/meeting-rooms/{room_id}")
async def delete_meeting_room(
    room_id: int,
    current_user: User = Depends(get_org_admin_user),
    db: Session = Depends(get_db)
):
    """Delete meeting room"""
    room = db.query(MeetingRoom).filter(MeetingRoom.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Meeting room not found")

    if room.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Delete associated islands
    db.query(MeetingRoomIsland).filter(
        MeetingRoomIsland.meeting_room_id == room_id
    ).delete()

    # Delete bookings
    db.query(MeetingRoomBooking).filter(
        MeetingRoomBooking.meeting_room_id == room_id
    ).delete()

    # Delete room
    db.delete(room)
    db.commit()

    return {"message": "Meeting room deleted successfully"}


@router.post("/meeting-rooms/bookings", response_model=MeetingRoomBookingResponse)
async def create_meeting_room_booking(
    booking: MeetingRoomBookingCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a meeting room booking"""
    if not current_user.organization_id:
        raise HTTPException(status_code=400, detail="User not associated with an organization")

    # Verify room exists
    room = db.query(MeetingRoom).filter(MeetingRoom.id == booking.meeting_room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Meeting room not found")
    
    if room.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Check for overlapping bookings
    overlapping = db.query(MeetingRoomBooking).filter(
        MeetingRoomBooking.meeting_room_id == booking.meeting_room_id,
        MeetingRoomBooking.status != MeetingRoomBookingStatus.CANCELLED,
        or_(
            and_(
                MeetingRoomBooking.start_time <= booking.start_time,
                MeetingRoomBooking.end_time > booking.start_time
            ),
            and_(
                MeetingRoomBooking.start_time < booking.end_time,
                MeetingRoomBooking.end_time >= booking.end_time
            ),
            and_(
                MeetingRoomBooking.start_time >= booking.start_time,
                MeetingRoomBooking.end_time <= booking.end_time
            )
        )
    ).first()

    if overlapping:
        raise HTTPException(status_code=400, detail="Meeting room is already booked for this time slot")

    # Create booking
    new_booking = MeetingRoomBooking(
        meeting_room_id=booking.meeting_room_id,
        booked_by_user_id=current_user.id,
        organization_id=current_user.organization_id,
        booking_date=booking.booking_date,
        start_time=booking.start_time,
        end_time=booking.end_time,
        title=booking.title,
        description=booking.description,
        attendees_count=booking.attendees_count,
        notes=booking.notes
    )

    db.add(new_booking)
    db.commit()
    db.refresh(new_booking)

    return MeetingRoomBookingResponse(
        id=new_booking.id,
        meeting_room_id=new_booking.meeting_room_id,
        booking_date=new_booking.booking_date,
        start_time=new_booking.start_time,
        end_time=new_booking.end_time,
        title=new_booking.title,
        description=new_booking.description,
        attendees_count=new_booking.attendees_count,
        status=new_booking.status.value,
        notes=new_booking.notes,
        created_at=new_booking.created_at
    )


@router.get("/meeting-rooms/bookings", response_model=list[MeetingRoomBookingResponse])
async def list_meeting_room_bookings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all meeting room bookings"""
    if not current_user.organization_id:
        raise HTTPException(status_code=400, detail="User not associated with an organization")

    bookings = db.query(MeetingRoomBooking).filter(
        MeetingRoomBooking.organization_id == current_user.organization_id
    ).all()

    return [
        MeetingRoomBookingResponse(
            id=b.id,
            meeting_room_id=b.meeting_room_id,
            booking_date=b.booking_date,
            start_time=b.start_time,
            end_time=b.end_time,
            title=b.title,
            description=b.description,
            attendees_count=b.attendees_count,
            status=b.status.value,
            notes=b.notes,
            created_at=b.created_at
        )
        for b in bookings
    ]
