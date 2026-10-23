'use client';

import { useState, useEffect } from 'react';
import { Calendar, MapPin, Monitor, Zap, Plus, X, Check, Building2, Users, Trash2, Layout, Video, Presentation } from 'lucide-react';
import FloorPlanEditor from './FloorPlanEditor';

const API_HOST = process.env.NEXT_PUBLIC_API_HOST || 'localhost';
const API_PORT = process.env.NEXT_PUBLIC_API_PORT || '8002';
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;

// ==================== Type Definitions ====================

interface DeskIsland {
  id: number;
  name: string;
  description?: string;
  floor?: string;
  building?: string;
  location?: string;
  total_desks: number;
  available_desks: number;
  has_monitors: boolean;
  has_docking_stations: boolean;
  has_standing_desks: boolean;
  status: 'available' | 'booked' | 'maintenance';
  is_active: boolean;
  is_bookable: boolean;
}

interface OfficeDesk {
  id: number;
  island_id: number;
  desk_number: string;
  position_in_island?: number;
  has_monitor: boolean;
  has_docking_station: boolean;
  has_standing_desk: boolean;
  status: 'available' | 'occupied' | 'maintenance';
  is_active: boolean;
}

interface IslandBooking {
  id: number;
  island_id: number;
  community_id: number;
  start_date: string;
  end_date: string;
  team_size?: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  notes?: string;
}

interface DeskBooking {
  id: number;
  desk_id: number;
  desk_number?: string;
  island_booking_id?: number;
  user_id: number;
  start_date: string;
  end_date: string;
  check_in_time?: string;
  check_out_time?: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  notes?: string;
}

interface ParkingSpace {
  id: number;
  space_number: string;
  level?: string;
  location?: string;
  building?: string;
  is_covered: boolean;
  has_ev_charging: boolean;
  is_handicap: boolean;
  status: 'available' | 'occupied' | 'maintenance';
  is_active: boolean;
}

interface MeetingRoomIsland {
  id: number;
  name: string;
  total_desks: number;
}

interface MeetingRoom {
  id: number;
  name: string;
  description?: string;
  floor?: string;
  building?: string;
  location?: string;
  capacity: number;
  has_projector: boolean;
  has_whiteboard: boolean;
  has_video_conference: boolean;
  has_phone: boolean;
  equipment_notes?: string;
  status: 'available' | 'booked' | 'maintenance';
  is_active: boolean;
  is_bookable: boolean;
  islands: MeetingRoomIsland[];
}

// ==================== Main Component ====================

export default function OfficeManagement({ userRole }: { userRole: string }) {
  const [activeTab, setActiveTab] = useState<'islands' | 'meeting-rooms' | 'floor-plan' | 'island-bookings' | 'desk-bookings' | 'parking'>('islands');
  
  // Data states
  const [islands, setIslands] = useState<DeskIsland[]>([]);
  const [desks, setDesks] = useState<OfficeDesk[]>([]);
  const [islandBookings, setIslandBookings] = useState<IslandBooking[]>([]);
  const [deskBookings, setDeskBookings] = useState<DeskBooking[]>([]);
  const [parkingSpaces, setParking] = useState<ParkingSpace[]>([]);
  const [meetingRooms, setMeetingRooms] = useState<MeetingRoom[]>([]);
  
  // UI states
  const [loading, setLoading] = useState(true);
  const [selectedIsland, setSelectedIsland] = useState<DeskIsland | null>(null);

  // Modal states
  const [showAddIslandModal, setShowAddIslandModal] = useState(false);
  const [showAddDeskModal, setShowAddDeskModal] = useState(false);
  const [showAddParkingModal, setShowAddParkingModal] = useState(false);
  const [showAddMeetingRoomModal, setShowAddMeetingRoomModal] = useState(false);

  // Form states
  const [islandForm, setIslandForm] = useState({
    name: '',
    description: '',
    floor: '',
    building: '',
    location: '',
    has_monitors: false,
    has_docking_stations: false,
    has_standing_desks: false
  });

  const [deskForm, setDeskForm] = useState({
    island_id: 0,
    desk_number: '',
    position_in_island: 0,
    has_monitor: false,
    has_docking_station: false,
    has_standing_desk: false
  });

  const [parkingForm, setParkingForm] = useState({
    space_number: '',
    level: '',
    location: '',
    building: '',
    is_covered: false,
    has_ev_charging: false,
    is_handicap: false
  });

  const [meetingRoomForm, setMeetingRoomForm] = useState({
    name: '',
    description: '',
    floor: '',
    building: '',
    location: '',
    capacity: 0,
    has_projector: false,
    has_whiteboard: false,
    has_video_conference: false,
    has_phone: false,
    equipment_notes: '',
    island_ids: [] as number[]
  });

  // Load data based on role and active tab
  useEffect(() => {
    loadData();
  }, [userRole, activeTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      if (userRole === 'org_admin') {
        if (activeTab === 'islands') await loadIslands(token);
        else if (activeTab === 'meeting-rooms') await loadMeetingRooms(token);
        else if (activeTab === 'island-bookings') await loadIslandBookings(token);
        else if (activeTab === 'parking') await loadParking(token);
      } else if (activeTab === 'desk-bookings') {
        await loadDeskBookings(token);
      } else if (activeTab === 'parking') {
        await loadParking(token);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadIslands = async (token: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/office/islands`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setIslands(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error loading islands:', error);
    }
  };

  const loadMeetingRooms = async (token: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/office/meeting-rooms`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setMeetingRooms(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error loading meeting rooms:', error);
    }
  };

  const loadIslandBookings = async (token: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/office/island-bookings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setIslandBookings(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error loading island bookings:', error);
    }
  };

  const loadDeskBookings = async (token: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/office/desk-bookings/my-bookings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setDeskBookings(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error loading desk bookings:', error);
    }
  };

  const loadParking = async (token: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/office/parking`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setParking(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error loading parking:', error);
    }
  };

  // ==================== Island Management (Admin Only) ====================

  const handleCreateIsland = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/api/office/islands`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(islandForm)
      });

      if (response.ok) {
        setShowAddIslandModal(false);
        setIslandForm({
          name: '',
          description: '',
          floor: '',
          building: '',
          location: '',
          has_monitors: false,
          has_docking_stations: false,
          has_standing_desks: false
        });
        const token = localStorage.getItem('token');
        if (token) await loadIslands(token);
      }
    } catch (error) {
      console.error('Error creating island:', error);
    }
  };

  const handleCreateDesk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIsland) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/api/office/islands/${selectedIsland.id}/desks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...deskForm,
          island_id: selectedIsland.id
        })
      });

      if (response.ok) {
        setShowAddDeskModal(false);
        setDeskForm({
          island_id: 0,
          desk_number: '',
          position_in_island: 0,
          has_monitor: false,
          has_docking_station: false,
          has_standing_desk: false
        });
        const token = localStorage.getItem('token');
        if (token) await loadIslands(token);
      }
    } catch (error) {
      console.error('Error creating desk:', error);
    }
  };

  const handleCreateParking = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/api/office/parking`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(parkingForm)
      });

      if (response.ok) {
        setShowAddParkingModal(false);
        setParkingForm({
          space_number: '',
          level: '',
          location: '',
          building: '',
          is_covered: false,
          has_ev_charging: false,
          is_handicap: false
        });
        const token = localStorage.getItem('token');
        if (token) await loadParking(token);
      }
    } catch (error) {
      console.error('Error creating parking:', error);
    }
  };

  // ==================== Meeting Room Management (Admin Only) ====================

  const handleCreateMeetingRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/api/office/meeting-rooms`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(meetingRoomForm)
      });

      if (response.ok) {
        setShowAddMeetingRoomModal(false);
        setMeetingRoomForm({
          name: '',
          description: '',
          floor: '',
          building: '',
          location: '',
          capacity: 0,
          has_projector: false,
          has_whiteboard: false,
          has_video_conference: false,
          has_phone: false,
          equipment_notes: '',
          island_ids: []
        });
        const token = localStorage.getItem('token');
        if (token) await loadMeetingRooms(token);
      }
    } catch (error) {
      console.error('Error creating meeting room:', error);
    }
  };

  const handleDeleteMeetingRoom = async (roomId: number) => {
    if (!confirm('Are you sure you want to delete this meeting room?')) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/api/office/meeting-rooms/${roomId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const token = localStorage.getItem('token');
        if (token) await loadMeetingRooms(token);
      }
    } catch (error) {
      console.error('Error deleting meeting room:', error);
    }
  };

  const toggleIslandSelection = (islandId: number) => {
    setMeetingRoomForm(prev => ({
      ...prev,
      island_ids: prev.island_ids.includes(islandId)
        ? prev.island_ids.filter(id => id !== islandId)
        : [...prev.island_ids, islandId]
    }));
  };

  const handleDeleteIsland = async (id: number) => {
    if (!confirm('Are you sure you want to delete this island?')) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/api/office/islands/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        if (token) await loadIslands(token);
        setSelectedIsland(null);
      }
    } catch (error) {
      console.error('Error deleting island:', error);
    }
  };

  const handleDeleteParking = async (id: number) => {
    if (!confirm('Are you sure you want to delete this parking space?')) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/api/office/parking/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        if (token) await loadParking(token);
      }
    } catch (error) {
      console.error('Error deleting parking:', error);
    }
  };

  // ==================== Render: Admin View ====================

  const renderAdminView = () => {
    return (
      <div className="space-y-6">
        {/* Tabs */}
        <div className="flex gap-2 border-b border-gray-700">
          <button
            onClick={() => setActiveTab('islands')}
            className={`px-4 py-2 font-medium border-b-2 transition ${
              activeTab === 'islands'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-300'
            }`}
          >
            🏝️ Islands
          </button>
          <button
            onClick={() => setActiveTab('meeting-rooms')}
            className={`px-4 py-2 font-medium border-b-2 transition flex items-center gap-2 ${
              activeTab === 'meeting-rooms'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-300'
            }`}
          >
            <Video size={18} /> Meeting Rooms
          </button>
          <button
            onClick={() => setActiveTab('floor-plan')}
            className={`px-4 py-2 font-medium border-b-2 transition flex items-center gap-2 ${
              activeTab === 'floor-plan'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-300'
            }`}
          >
            <Layout size={18} /> Floor Plan
          </button>
          <button
            onClick={() => setActiveTab('island-bookings')}
            className={`px-4 py-2 font-medium border-b-2 transition ${
              activeTab === 'island-bookings'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-300'
            }`}
          >
            📅 Island Bookings
          </button>
          <button
            onClick={() => setActiveTab('parking')}
            className={`px-4 py-2 font-medium border-b-2 transition ${
              activeTab === 'parking'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-300'
            }`}
          >
            🅿️ Parking
          </button>
        </div>

        {/* Islands Tab */}
        {activeTab === 'islands' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-white">Desk Islands</h3>
              <button
                onClick={() => setShowAddIslandModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
              >
                <Plus size={20} /> Create Island
              </button>
            </div>

            {loading ? (
              <div className="text-center text-gray-400">Loading islands...</div>
            ) : islands.length === 0 ? (
              <div className="text-center text-gray-400 py-8">No islands created yet</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {islands.map(island => (
                  <div
                    key={island.id}
                    className="p-4 bg-gray-800 rounded-lg border border-gray-700 hover:border-blue-500 transition cursor-pointer"
                    onClick={() => setSelectedIsland(island)}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <h4 className="text-lg font-semibold text-white">{island.name}</h4>
                        <p className="text-sm text-gray-400">{island.description}</p>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ml-2 ${
                        island.status === 'available'
                          ? 'bg-green-900 text-green-300'
                          : island.status === 'booked'
                          ? 'bg-blue-900 text-blue-300'
                          : 'bg-red-900 text-red-300'
                      }`}>
                        {island.status.toUpperCase()}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                      {island.floor && <div className="text-gray-400">Floor: {island.floor}</div>}
                      {island.building && <div className="text-gray-400">Building: {island.building}</div>}
                      <div className="text-gray-400">Desks: {island.available_desks}/{island.total_desks}</div>
                    </div>

                    <div className="flex gap-2 flex-wrap">
                      {island.has_monitors && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-gray-700 rounded text-xs text-gray-300">
                          <Monitor size={14} /> Monitors
                        </div>
                      )}
                      {island.has_docking_stations && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-gray-700 rounded text-xs text-gray-300">
                          <Zap size={14} /> Docking
                        </div>
                      )}
                      {island.has_standing_desks && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-gray-700 rounded text-xs text-gray-300">
                          📏 Standing
                        </div>
                      )}
                    </div>

                    {selectedIsland?.id === island.id && (
                      <div className="mt-4 pt-4 border-t border-gray-700 space-y-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowAddDeskModal(true);
                          }}
                          className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition"
                        >
                          + Add Desk
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteIsland(island.id);
                          }}
                          className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition"
                        >
                          Delete Island
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Floor Plan Tab */}
        {activeTab === 'floor-plan' && (
          <div>
            <FloorPlanEditor />
          </div>
        )}

        {/* Meeting Rooms Tab */}
        {activeTab === 'meeting-rooms' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-white">Meeting Rooms</h3>
              <button
                onClick={() => {
                  // Load islands first
                  const token = localStorage.getItem('token');
                  if (token) loadIslands(token);
                  setShowAddMeetingRoomModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition"
              >
                <Plus size={18} /> Create Meeting Room
              </button>
            </div>

            {loading ? (
              <div className="text-center text-gray-400">Loading meeting rooms...</div>
            ) : meetingRooms.length === 0 ? (
              <div className="text-center text-gray-400 py-8">No meeting rooms yet</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {meetingRooms.map(room => (
                  <div key={room.id} className="p-4 bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 transition">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="font-bold text-white">{room.name}</h4>
                        {room.description && (
                          <p className="text-sm text-gray-400 mt-1">{room.description}</p>
                        )}
                      </div>
                      <span className={`px-2 py-1 rounded text-xs ${
                        room.status === 'available' 
                          ? 'bg-green-900/30 text-green-400' 
                          : room.status === 'booked'
                          ? 'bg-orange-900/30 text-orange-400'
                          : 'bg-red-900/30 text-red-400'
                      }`}>
                        {room.status.toUpperCase()}
                      </span>
                    </div>

                    <div className="space-y-2 mb-3">
                      {room.floor && (
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          <Building2 size={14} />
                          <span>Floor: {room.floor}</span>
                        </div>
                      )}
                      {room.building && (
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          <MapPin size={14} />
                          <span>{room.building}</span>
                        </div>
                      )}
                      {room.capacity > 0 && (
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          <Users size={14} />
                          <span>Capacity: {room.capacity}</span>
                        </div>
                      )}
                    </div>

                    {/* Equipment Features */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      {room.has_projector && (
                        <span className="px-2 py-1 bg-purple-900/30 text-purple-400 text-xs rounded flex items-center gap-1">
                          <Presentation size={12} /> Projector
                        </span>
                      )}
                      {room.has_video_conference && (
                        <span className="px-2 py-1 bg-blue-900/30 text-blue-400 text-xs rounded flex items-center gap-1">
                          <Video size={12} /> Video Conf
                        </span>
                      )}
                      {room.has_whiteboard && (
                        <span className="px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded">
                          Whiteboard
                        </span>
                      )}
                      {room.has_phone && (
                        <span className="px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded">
                          Phone
                        </span>
                      )}
                    </div>

                    {/* Islands */}
                    {room.islands && room.islands.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs text-gray-500 mb-1">Includes Islands:</p>
                        <div className="flex flex-wrap gap-1">
                          {room.islands.map(island => (
                            <span key={island.id} className="px-2 py-0.5 bg-gray-700/50 text-gray-300 text-xs rounded">
                              {island.name} ({island.total_desks} desks)
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={() => handleDeleteMeetingRoom(room.id)}
                      className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition"
                    >
                      Delete Room
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Island Bookings Tab */}
        {activeTab === 'island-bookings' && (
          <div>
            <h3 className="text-xl font-bold text-white mb-6">Island Bookings</h3>

            {loading ? (
              <div className="text-center text-gray-400">Loading bookings...</div>
            ) : islandBookings.length === 0 ? (
              <div className="text-center text-gray-400 py-8">No island bookings yet</div>
            ) : (
              <div className="space-y-3">
                {islandBookings.map(booking => (
                  <div key={booking.id} className="p-4 bg-gray-800 rounded-lg border border-gray-700">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-semibold text-white">Island #{booking.island_id}</h4>
                        <p className="text-sm text-gray-400">
                          {new Date(booking.start_date).toLocaleDateString()} - {new Date(booking.end_date).toLocaleDateString()}
                        </p>
                        {booking.team_size && (
                          <p className="text-sm text-gray-400">Team Size: {booking.team_size}</p>
                        )}
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${
                        booking.status === 'confirmed'
                          ? 'bg-green-900 text-green-300'
                          : booking.status === 'pending'
                          ? 'bg-yellow-900 text-yellow-300'
                          : 'bg-red-900 text-red-300'
                      }`}>
                        {booking.status.toUpperCase()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Parking Tab */}
        {activeTab === 'parking' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-white">Parking Spaces</h3>
              <button
                onClick={() => setShowAddParkingModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
              >
                <Plus size={20} /> Add Parking
              </button>
            </div>

            {loading ? (
              <div className="text-center text-gray-400">Loading parking...</div>
            ) : parkingSpaces.length === 0 ? (
              <div className="text-center text-gray-400 py-8">No parking spaces configured</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {parkingSpaces.map(space => (
                  <div key={space.id} className="p-4 bg-gray-800 rounded-lg border border-gray-700">
                    <div className="flex justify-between items-start mb-3">
                      <h4 className="text-lg font-semibold text-white">{space.space_number}</h4>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        space.status === 'available'
                          ? 'bg-green-900 text-green-300'
                          : space.status === 'occupied'
                          ? 'bg-red-900 text-red-300'
                          : 'bg-yellow-900 text-yellow-300'
                      }`}>
                        {space.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-sm text-gray-400 mb-3">
                      {space.level && <p>Level: {space.level}</p>}
                      {space.location && <p>Location: {space.location}</p>}
                    </div>
                    <div className="flex gap-2 flex-wrap mb-3">
                      {space.is_covered && (
                        <div className="px-2 py-1 bg-gray-700 rounded text-xs text-gray-300">🏠 Covered</div>
                      )}
                      {space.has_ev_charging && (
                        <div className="px-2 py-1 bg-gray-700 rounded text-xs text-gray-300">⚡ EV Charging</div>
                      )}
                      {space.is_handicap && (
                        <div className="px-2 py-1 bg-gray-700 rounded text-xs text-gray-300">♿ Handicap</div>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteParking(space.id)}
                      className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderUserView = () => {
    return (
      <div className="space-y-6">
        <div className="flex gap-2 border-b border-gray-700">
          <button
            onClick={() => setActiveTab('desk-bookings')}
            className={`px-4 py-2 font-medium border-b-2 transition ${
              activeTab === 'desk-bookings'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-300'
            }`}
          >
            💼 My Desk Bookings
          </button>
          <button
            onClick={() => setActiveTab('parking')}
            className={`px-4 py-2 font-medium border-b-2 transition ${
              activeTab === 'parking'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-300'
            }`}
          >
            🚗 My Parking
          </button>
        </div>

        {activeTab === 'desk-bookings' && (
          <div>
            <h3 className="text-xl font-bold text-white mb-6">My Desk Bookings</h3>

            {loading ? (
              <div className="text-center text-gray-400">Loading bookings...</div>
            ) : deskBookings.length === 0 ? (
              <div className="text-center text-gray-400 py-8">No desk bookings yet</div>
            ) : (
              <div className="space-y-3">
                {deskBookings.map(booking => (
                  <div key={booking.id} className="p-4 bg-gray-800 rounded-lg border border-gray-700">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h4 className="font-semibold text-white">Desk #{booking.desk_number || booking.desk_id}</h4>
                        <p className="text-sm text-gray-400">
                          {new Date(booking.start_date).toLocaleDateString()} - {new Date(booking.end_date).toLocaleDateString()}
                        </p>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        booking.status === 'confirmed'
                          ? 'bg-green-900 text-green-300'
                          : booking.status === 'pending'
                          ? 'bg-yellow-900 text-yellow-300'
                          : 'bg-red-900 text-red-300'
                      }`}>
                        {booking.status.toUpperCase()}
                      </span>
                    </div>
                    {booking.check_in_time && (
                      <div className="text-xs text-gray-400">
                        Checked in: {new Date(booking.check_in_time).toLocaleTimeString()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'parking' && (
          <div>
            <h3 className="text-xl font-bold text-white mb-6">Parking Spaces</h3>

            {loading ? (
              <div className="text-center text-gray-400">Loading parking...</div>
            ) : parkingSpaces.length === 0 ? (
              <div className="text-center text-gray-400 py-8">No parking spaces available</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {parkingSpaces.map(space => (
                  <div key={space.id} className="p-4 bg-gray-800 rounded-lg border border-gray-700">
                    <div className="flex justify-between items-start mb-3">
                      <h4 className="text-lg font-semibold text-white">{space.space_number}</h4>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        space.status === 'available'
                          ? 'bg-green-900 text-green-300'
                          : space.status === 'occupied'
                          ? 'bg-red-900 text-red-300'
                          : 'bg-yellow-900 text-yellow-300'
                      }`}>
                        {space.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-sm text-gray-400">
                      {space.level && <p>Level: {space.level}</p>}
                      {space.location && <p>Location: {space.location}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ==================== Modals ====================

  return (
    <div className="w-full bg-gray-900 text-white p-6 rounded-lg">
      <div className="flex items-center gap-3 mb-8">
        <Building2 size={32} className="text-blue-400" />
        <div>
          <h2 className="text-3xl font-bold">Workspace Management</h2>
          <p className="text-gray-400">Manage desks, islands, and parking</p>
        </div>
      </div>

      {userRole === 'org_admin' ? renderAdminView() : renderUserView()}

      {/* Add Island Modal */}
      {showAddIslandModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-96 max-h-screen overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-white">Create New Island</h3>
              <button onClick={() => setShowAddIslandModal(false)} className="text-gray-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleCreateIsland} className="space-y-4">
              <input
                type="text"
                placeholder="Island Name"
                value={islandForm.name}
                onChange={(e) => setIslandForm({ ...islandForm, name: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
                required
              />
              <textarea
                placeholder="Description"
                value={islandForm.description}
                onChange={(e) => setIslandForm({ ...islandForm, description: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
              />
              <input
                type="text"
                placeholder="Floor"
                value={islandForm.floor}
                onChange={(e) => setIslandForm({ ...islandForm, floor: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
              />
              <input
                type="text"
                placeholder="Building"
                value={islandForm.building}
                onChange={(e) => setIslandForm({ ...islandForm, building: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
              />

              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={islandForm.has_monitors}
                    onChange={(e) => setIslandForm({ ...islandForm, has_monitors: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span>All desks have monitors</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={islandForm.has_docking_stations}
                    onChange={(e) => setIslandForm({ ...islandForm, has_docking_stations: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span>All desks have docking stations</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={islandForm.has_standing_desks}
                    onChange={(e) => setIslandForm({ ...islandForm, has_standing_desks: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span>All desks are standing desks</span>
                </label>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition flex items-center justify-center gap-2"
                >
                  <Check size={20} /> Create
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddIslandModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Desk Modal */}
      {showAddDeskModal && selectedIsland && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-96 max-h-screen overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-white">Add Desk to {selectedIsland.name}</h3>
              <button onClick={() => setShowAddDeskModal(false)} className="text-gray-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleCreateDesk} className="space-y-4">
              <input
                type="text"
                placeholder="Desk Number"
                value={deskForm.desk_number}
                onChange={(e) => setDeskForm({ ...deskForm, desk_number: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
                required
              />
              <input
                type="number"
                placeholder="Position in Island"
                value={deskForm.position_in_island}
                onChange={(e) => setDeskForm({ ...deskForm, position_in_island: parseInt(e.target.value) })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
              />

              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deskForm.has_monitor}
                    onChange={(e) => setDeskForm({ ...deskForm, has_monitor: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span>Has monitor</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deskForm.has_docking_station}
                    onChange={(e) => setDeskForm({ ...deskForm, has_docking_station: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span>Has docking station</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deskForm.has_standing_desk}
                    onChange={(e) => setDeskForm({ ...deskForm, has_standing_desk: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span>Is standing desk</span>
                </label>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition flex items-center justify-center gap-2"
                >
                  <Check size={20} /> Add Desk
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddDeskModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Parking Modal */}
      {showAddParkingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-96 max-h-screen overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-white">Add Parking Space</h3>
              <button onClick={() => setShowAddParkingModal(false)} className="text-gray-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleCreateParking} className="space-y-4">
              <input
                type="text"
                placeholder="Space Number"
                value={parkingForm.space_number}
                onChange={(e) => setParkingForm({ ...parkingForm, space_number: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
                required
              />
              <input
                type="text"
                placeholder="Level"
                value={parkingForm.level}
                onChange={(e) => setParkingForm({ ...parkingForm, level: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
              />
              <input
                type="text"
                placeholder="Location"
                value={parkingForm.location}
                onChange={(e) => setParkingForm({ ...parkingForm, location: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
              />
              <input
                type="text"
                placeholder="Building"
                value={parkingForm.building}
                onChange={(e) => setParkingForm({ ...parkingForm, building: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
              />

              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={parkingForm.is_covered}
                    onChange={(e) => setParkingForm({ ...parkingForm, is_covered: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span>Covered parking</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={parkingForm.has_ev_charging}
                    onChange={(e) => setParkingForm({ ...parkingForm, has_ev_charging: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span>EV charging available</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={parkingForm.is_handicap}
                    onChange={(e) => setParkingForm({ ...parkingForm, is_handicap: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span>Handicap accessible</span>
                </label>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition flex items-center justify-center gap-2"
                >
                  <Check size={20} /> Add
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddParkingModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Meeting Room Modal */}
      {showAddMeetingRoomModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-[600px] max-h-screen overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-white">Create Meeting Room</h3>
              <button onClick={() => setShowAddMeetingRoomModal(false)} className="text-gray-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleCreateMeetingRoom} className="space-y-4">
              <input
                type="text"
                placeholder="Room Name *"
                value={meetingRoomForm.name}
                onChange={(e) => setMeetingRoomForm({ ...meetingRoomForm, name: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
                required
              />
              <textarea
                placeholder="Description"
                value={meetingRoomForm.description}
                onChange={(e) => setMeetingRoomForm({ ...meetingRoomForm, description: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
                rows={3}
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Floor"
                  value={meetingRoomForm.floor}
                  onChange={(e) => setMeetingRoomForm({ ...meetingRoomForm, floor: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
                />
                <input
                  type="text"
                  placeholder="Building"
                  value={meetingRoomForm.building}
                  onChange={(e) => setMeetingRoomForm({ ...meetingRoomForm, building: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
                />
              </div>
              <input
                type="text"
                placeholder="Location"
                value={meetingRoomForm.location}
                onChange={(e) => setMeetingRoomForm({ ...meetingRoomForm, location: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
              />
              <input
                type="number"
                placeholder="Capacity"
                value={meetingRoomForm.capacity || ''}
                onChange={(e) => setMeetingRoomForm({ ...meetingRoomForm, capacity: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
              />

              <div className="space-y-2">
                <p className="text-sm text-gray-400">Equipment:</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={meetingRoomForm.has_projector}
                      onChange={(e) => setMeetingRoomForm({ ...meetingRoomForm, has_projector: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Projector</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={meetingRoomForm.has_whiteboard}
                      onChange={(e) => setMeetingRoomForm({ ...meetingRoomForm, has_whiteboard: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Whiteboard</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={meetingRoomForm.has_video_conference}
                      onChange={(e) => setMeetingRoomForm({ ...meetingRoomForm, has_video_conference: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Video Conference</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={meetingRoomForm.has_phone}
                      onChange={(e) => setMeetingRoomForm({ ...meetingRoomForm, has_phone: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Phone</span>
                  </label>
                </div>
              </div>

              <textarea
                placeholder="Equipment Notes"
                value={meetingRoomForm.equipment_notes}
                onChange={(e) => setMeetingRoomForm({ ...meetingRoomForm, equipment_notes: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
                rows={2}
              />

              {/* Island Selection */}
              <div className="space-y-2">
                <p className="text-sm text-gray-400">Include Islands (optional):</p>
                <div className="max-h-40 overflow-y-auto space-y-1 border border-gray-600 rounded p-2">
                  {islands.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-2">No islands available</p>
                  ) : (
                    islands.map(island => (
                      <label key={island.id} className="flex items-center gap-2 cursor-pointer p-2 hover:bg-gray-700 rounded">
                        <input
                          type="checkbox"
                          checked={meetingRoomForm.island_ids.includes(island.id)}
                          onChange={() => toggleIslandSelection(island.id)}
                          className="w-4 h-4"
                        />
                        <span className="text-sm">{island.name} ({island.total_desks} desks)</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition flex items-center justify-center gap-2"
                >
                  <Check size={20} /> Create Room
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddMeetingRoomModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
