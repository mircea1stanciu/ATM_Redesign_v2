'use client';

import { useState, useRef, useEffect } from 'react';
import { 
  Plus, ZoomIn, ZoomOut, Save, Trash2, Video, Building2, 
  DoorOpen, Navigation, Grid3x3, Maximize2, Users, Monitor, RotateCw, RotateCcw,
  Download, Upload, Layers, Lock, Unlock
} from 'lucide-react';

const API_HOST = process.env.NEXT_PUBLIC_API_HOST || 'localhost';
const API_PORT = process.env.NEXT_PUBLIC_API_PORT || '8002';
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;

// ==================== Types ====================

interface Position {
  x: number;
  y: number;
}

type Region = 'north-west' | 'north-east' | 'south-west' | 'south-east';
type ElevatorZoneSide = 'north' | 'south' | 'east' | 'west';

interface RegionEntrance {
  id: string;
  side: ElevatorZoneSide; // Which side of elevator zone (north, south, east, west)
  position: number; // Position along that side (0-1, where 0.5 is center)
  width: number; // Width in grid cells
  targetRegion: Region | null; // Which region this entrance connects to
  hasHallway: boolean; // Does this entrance have a hallway around elevator zone
  hallwayPath?: 'clockwise' | 'counterclockwise'; // Direction of hallway if it goes around
}

interface RegionConfig {
  enabled: boolean;
  color: string;
  label: string;
  hasEntrance: boolean; // Legacy - kept for compatibility
  width: number; // Region width in pixels
  height: number; // Region height in pixels
  position?: { x: number; y: number }; // Optional position offset for dragging
}

interface PlaceableItem {
  id: string;
  type: 'island' | 'meeting-room';
  backend_id?: number;
  name: string;
  position: Position; // Grid coordinates
  width: number; // Grid units
  height: number;
  region: Region;
  // Island specific
  desks?: number;
  has_monitors?: boolean;
  has_docking_stations?: boolean;
  has_standing_desks?: boolean;
  // Meeting room specific
  capacity?: number;
  has_projector?: boolean;
  has_whiteboard?: boolean;
  has_video_conference?: boolean;
  has_phone?: boolean;
  // Common
  status: 'available' | 'booked' | 'maintenance';
}

interface Staircase {
  id: string;
  position: { row: number; col: number }; // Position in the elevator zone grid
  width: number; // Width in grid cells (default 2)
  height: number; // Height in grid cells (default 1.5)
  direction: 'up' | 'down' | 'both'; // Up, down, or bidirectional
  entrance?: {
    side: 'north' | 'south' | 'east' | 'west';
    targetRegion?: 'north-west' | 'north-east' | 'south-west' | 'south-east' | null;
  };
}

interface Elevator {
  id: string;
  position: { row: number; col: number }; // Position in the elevator zone grid
  exits: ('north' | 'south' | 'east' | 'west')[]; // Individual exits for this elevator
}

interface ElevatorZoneConfig {
  size: number; // Size in grid cells (e.g., 12, 14, 16)
  entrances: RegionEntrance[]; // Multiple configurable entrances
}

type DrawingElementType = 'technical-room' | 'wall' | 'toilet' | 'emergency-exit' | 'balcony';

interface DrawingElement {
  id: string;
  type: DrawingElementType;
  position: { row: number; col: number }; // Position in grid
  width: number; // Width in grid cells
  height: number; // Height in grid cells
  rotation: 0 | 90 | 180 | 270; // Rotation in degrees
  label?: string; // Optional label for the element
  // Wall specific
  orientation?: 'horizontal' | 'vertical';
  // Technical room specific
  roomType?: 'electrical' | 'mechanical' | 'server' | 'storage' | 'janitor';
  // Toilet specific
  toiletType?: 'men' | 'women' | 'accessible' | 'unisex';
}

interface FloorPlan {
  building: string;
  floor: string;
  regions: Record<Region, RegionConfig>;
  items: PlaceableItem[];
  elevators: Elevator[];
  staircases: Staircase[]; // Added stairs
  elevatorZone: ElevatorZoneConfig;
  drawings: DrawingElement[]; // New drawing elements
  // Canvas view settings
  viewSettings?: {
    zoom: number;
    rotation: number;
    pan: Position;
    canvasSize: { width: number; height: number };
    isLocked: boolean; // Save lock state with view settings
  };
}

// ==================== Main Component ====================

export default function FloorPlanEditor() {
  const [floorPlan, setFloorPlan] = useState<FloorPlan>({
    building: 'Main Building',
    floor: '1',
    regions: {
      'north-west': { enabled: true, color: '#3b82f6', label: 'North-West', hasEntrance: true, width: 800, height: 700 },
      'north-east': { enabled: true, color: '#10b981', label: 'North-East', hasEntrance: true, width: 1000, height: 700 },
      'south-west': { enabled: true, color: '#f59e0b', label: 'South-West', hasEntrance: true, width: 800, height: 1100 },
      'south-east': { enabled: true, color: '#8b5cf6', label: 'South-East', hasEntrance: true, width: 1000, height: 1100 }
    },
    items: [],
    elevators: [
      { id: '1', position: { row: 2, col: 2 }, exits: ['north', 'south', 'east', 'west'] },
      { id: '2', position: { row: 2, col: 3 }, exits: ['north', 'south', 'east', 'west'] }
    ],
    staircases: [
      { id: '1', position: { row: 1, col: 1 }, width: 2, height: 1.5, direction: 'both' }
    ],
    elevatorZone: {
      size: 20, // 20x20 cells (maximum size for spacious elevator area)
      entrances: [
        // North side entrance to north-west region
        { id: '1', side: 'north', position: 0.25, width: 2, targetRegion: 'north-west', hasHallway: false },
        // North side entrance to north-east region
        { id: '2', side: 'north', position: 0.75, width: 2, targetRegion: 'north-east', hasHallway: false },
        // South side entrance to south-west region
        { id: '3', side: 'south', position: 0.25, width: 2, targetRegion: 'south-west', hasHallway: false },
        // South side entrance to south-east region
        { id: '4', side: 'south', position: 0.75, width: 2, targetRegion: 'south-east', hasHallway: false },
      ]
    },
    drawings: []
  });

  const [islands, setIslands] = useState<any[]>([]);
  const [meetingRooms, setMeetingRooms] = useState<any[]>([]);
  const [selectedItem, setSelectedItem] = useState<PlaceableItem | null>(null);
  const [selectedElevatorId, setSelectedElevatorId] = useState<string | null>(null);
  const [selectedStaircaseId, setSelectedStaircaseId] = useState<string | null>(null);
  const [selectedEntranceId, setSelectedEntranceId] = useState<string | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<PlaceableItem | null>(null);
  const [draggedDrawing, setDraggedDrawing] = useState<DrawingElement | null>(null);
  const [draggedRegion, setDraggedRegion] = useState<Region | null>(null); // Track dragged region
  const [dragOffset, setDragOffset] = useState<Position>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false); // Track canvas panning state
  const [panStart, setPanStart] = useState<Position>({ x: 0, y: 0 }); // Starting position for pan
  const [isCanvasLocked, setIsCanvasLocked] = useState(false); // Lock/unlock canvas panning
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0); // Rotation in degrees (0, 90, 180, 270)
  const [pan, setPan] = useState<Position>({ x: 0, y: 0 }); // Centered by default at (0, 0) with the transform
  const [canvasSize, setCanvasSize] = useState({ width: 2000, height: 2000 }); // Dynamic canvas size - default 2000x2000
  const [showAddModal, setShowAddModal] = useState(false);
  const [addItemType, setAddItemType] = useState<'island' | 'meeting-room'>('island');
  
  // Multi-floor management
  const [savedFloors, setSavedFloors] = useState<Map<string, FloorPlan>>(new Map());
  const [availableFloors, setAvailableFloors] = useState<string[]>(['1']);
  const [showFloorManager, setShowFloorManager] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [newFloorNumber, setNewFloorNumber] = useState('');
  const [syncRegionsAcrossFloors, setSyncRegionsAcrossFloors] = useState(false);
  
  // Sidebar tabs
  const [activeTab, setActiveTab] = useState<'general' | 'elevators' | 'staircases' | 'zone' | 'drawings'>('general');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragPosRef = useRef<Position | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  const GRID_SIZE = 20; // pixels per grid cell
  const CANVAS_WIDTH = canvasSize.width;
  const CANVAS_HEIGHT = canvasSize.height;
  const GRID_COLS = Math.floor(CANVAS_WIDTH / GRID_SIZE);
  const GRID_ROWS = Math.floor(CANVAS_HEIGHT / GRID_SIZE);

  // Load data from backend
  useEffect(() => {
    loadIslands();
    loadMeetingRooms();
  }, []);

  const loadIslands = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const response = await fetch(`${API_BASE_URL}/api/office/islands`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setIslands(data);
      }
    } catch (error) {
      console.error('Error loading islands:', error);
    }
  };

  const loadMeetingRooms = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const response = await fetch(`${API_BASE_URL}/api/office/meeting-rooms`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setMeetingRooms(data);
      }
    } catch (error) {
      console.error('Error loading meeting rooms:', error);
    }
  };

  // ==================== Floor Plan Save/Load Functions ====================
  
  // Load saved floor plans from localStorage on mount
  useEffect(() => {
    loadSavedFloors();
  }, []);

  // Save sync preference when it changes
  useEffect(() => {
    localStorage.setItem('syncRegionsAcrossFloors', syncRegionsAcrossFloors.toString());
    
    // If sync is being enabled, immediately sync current config to all floors
    if (syncRegionsAcrossFloors && availableFloors.length > 1) {
      syncFloorConfigToAllFloors(floorPlan);
    }
  }, [syncRegionsAcrossFloors]);

  // Save canvas view settings (pan, zoom, rotation, canvasSize, lock) when they change
  // Using debounce to avoid excessive saves during dragging
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      try {
        const floorPlanWithView = {
          ...floorPlan,
          viewSettings: {
            zoom,
            rotation,
            pan,
            canvasSize,
            isLocked: isCanvasLocked
          }
        };
        
        const updatedFloors = new Map(savedFloors);
        updatedFloors.set(floorPlan.floor, floorPlanWithView);
        
        // Convert Map to object for localStorage
        const floorsObject = Object.fromEntries(updatedFloors);
        localStorage.setItem('floorPlans', JSON.stringify(floorsObject));
        
        // Also save global lock preference
        localStorage.setItem('isCanvasLocked', isCanvasLocked.toString());
        
        // Update savedFloors state
        setSavedFloors(updatedFloors);
      } catch (error) {
        console.error('Error saving view settings to floor plan:', error);
      }
    }, 300); // Debounce 300ms to avoid too frequent saves during pan dragging
    
    return () => clearTimeout(timeoutId);
  }, [pan, zoom, rotation, canvasSize, isCanvasLocked, floorPlan.floor]);

  const loadSavedFloors = () => {
    try {
      const saved = localStorage.getItem('floorPlans');
      let hasLoadedViewSettings = false;
      
      if (saved) {
        const parsed = JSON.parse(saved);
        const floorsMap = new Map<string, FloorPlan>(Object.entries(parsed).map(([key, value]: [string, any]) => {
          // Ensure drawings array exists for backward compatibility
          return [key, {
            ...value,
            drawings: value.drawings || []
          }];
        }));
        setSavedFloors(floorsMap);
        setAvailableFloors(Array.from(floorsMap.keys()).sort((a, b) => parseInt(a) - parseInt(b)));
        
        // Load the current floor if it exists
        if (floorsMap.has(floorPlan.floor)) {
          const loadedFloor = floorsMap.get(floorPlan.floor)!;
          setFloorPlan({
            ...loadedFloor,
            drawings: loadedFloor.drawings || []
          });
          
          // Restore view settings if they exist
          if (loadedFloor.viewSettings) {
            setZoom(loadedFloor.viewSettings.zoom);
            setRotation(loadedFloor.viewSettings.rotation);
            setPan(loadedFloor.viewSettings.pan);
            setCanvasSize(loadedFloor.viewSettings.canvasSize);
            setIsCanvasLocked(loadedFloor.viewSettings.isLocked ?? false);
            hasLoadedViewSettings = true;
          }
        }
      }
      
      // Load sync preference
      const syncPref = localStorage.getItem('syncRegionsAcrossFloors');
      if (syncPref !== null) {
        setSyncRegionsAcrossFloors(syncPref === 'true');
      }
      
      // Load canvas lock preference (fallback if not loaded from viewSettings)
      if (!hasLoadedViewSettings) {
        const lockPref = localStorage.getItem('isCanvasLocked');
        if (lockPref !== null) {
          setIsCanvasLocked(lockPref === 'true');
        }
      }
    } catch (error) {
      console.error('Error loading saved floors:', error);
    }
  };

  // Save current floor plan to localStorage
  const saveCurrentFloor = () => {
    try {
      // Save floor plan with current view settings including lock state
      const floorPlanWithView = {
        ...floorPlan,
        viewSettings: {
          zoom,
          rotation,
          pan,
          canvasSize,
          isLocked: isCanvasLocked
        }
      };
      
      const updatedFloors = new Map(savedFloors);
      updatedFloors.set(floorPlan.floor, floorPlanWithView);
      setSavedFloors(updatedFloors);
      
      // Convert Map to object for localStorage
      const floorsObject = Object.fromEntries(updatedFloors);
      localStorage.setItem('floorPlans', JSON.stringify(floorsObject));
      
      // Update available floors list
      const floors = Array.from(updatedFloors.keys()).sort((a, b) => parseInt(a) - parseInt(b));
      setAvailableFloors(floors);
      
      alert(`Floor ${floorPlan.floor} saved successfully!`);
    } catch (error) {
      console.error('Error saving floor:', error);
      alert('Error saving floor plan');
    }
  };

  // Switch to a different floor
  const switchToFloor = (floorNumber: string) => {
    // Save current floor before switching (with view settings including lock state)
    const floorPlanWithView = {
      ...floorPlan,
      viewSettings: {
        zoom,
        rotation,
        pan,
        canvasSize,
        isLocked: isCanvasLocked
      }
    };
    
    const updatedFloors = new Map(savedFloors);
    updatedFloors.set(floorPlan.floor, floorPlanWithView);
    setSavedFloors(updatedFloors);
    
    // Save to localStorage immediately
    const floorsObject = Object.fromEntries(updatedFloors);
    localStorage.setItem('floorPlans', JSON.stringify(floorsObject));
    
    // Load the new floor or create a default one
    if (updatedFloors.has(floorNumber)) {
      const loadedFloor = updatedFloors.get(floorNumber)!;
      setFloorPlan({
        ...loadedFloor,
        drawings: loadedFloor.drawings || []
      });
      
      // Restore view settings if they exist
      if (loadedFloor.viewSettings) {
        setZoom(loadedFloor.viewSettings.zoom);
        setRotation(loadedFloor.viewSettings.rotation);
        setPan(loadedFloor.viewSettings.pan);
        setCanvasSize(loadedFloor.viewSettings.canvasSize);
        setIsCanvasLocked(loadedFloor.viewSettings.isLocked ?? false);
      } else {
        // Reset to defaults if no view settings saved
        setZoom(1);
        setRotation(0);
        setPan({ x: 0, y: 0 });
        setCanvasSize({ width: 2000, height: 2000 });
        setIsCanvasLocked(false);
      }
    } else {
      // Create new floor with default settings
      // If sync is enabled, use current floor's region config
      const regionConfig = syncRegionsAcrossFloors ? floorPlan.regions : {
        'north-west': { enabled: true, color: '#3b82f6', label: 'North-West', hasEntrance: true, width: 800, height: 700 },
        'north-east': { enabled: true, color: '#10b981', label: 'North-East', hasEntrance: true, width: 1000, height: 700 },
        'south-west': { enabled: true, color: '#f59e0b', label: 'South-West', hasEntrance: true, width: 800, height: 1100 },
        'south-east': { enabled: true, color: '#8b5cf6', label: 'South-East', hasEntrance: true, width: 1000, height: 1100 }
      };
      
      setFloorPlan({
        building: floorPlan.building,
        floor: floorNumber,
        regions: regionConfig,
        items: [],
        elevators: [
          { id: '1', position: { row: 2, col: 2 }, exits: ['north', 'south', 'east', 'west'] },
          { id: '2', position: { row: 2, col: 3 }, exits: ['north', 'south', 'east', 'west'] }
        ],
        staircases: [
          { id: '1', position: { row: 1, col: 1 }, width: 2, height: 1.5, direction: 'both' }
        ],
        elevatorZone: {
          size: 20,
          entrances: [
            { id: '1', side: 'north', position: 0.25, width: 2, targetRegion: 'north-west', hasHallway: false },
            { id: '2', side: 'north', position: 0.75, width: 2, targetRegion: 'north-east', hasHallway: false },
            { id: '3', side: 'south', position: 0.25, width: 2, targetRegion: 'south-west', hasHallway: false },
            { id: '4', side: 'south', position: 0.75, width: 2, targetRegion: 'south-east', hasHallway: false },
          ]
        },
        drawings: []
      });
    }
  };

  // Add a new floor
  const addNewFloor = () => {
    if (!newFloorNumber) {
      alert('Please enter a floor number');
      return;
    }
    
    if (availableFloors.includes(newFloorNumber)) {
      alert('Floor already exists');
      return;
    }
    
    // Add to available floors list
    const updatedAvailableFloors = [...availableFloors, newFloorNumber].sort((a, b) => parseInt(a) - parseInt(b));
    setAvailableFloors(updatedAvailableFloors);
    
    switchToFloor(newFloorNumber);
    setNewFloorNumber('');
    setShowFloorManager(false);
  };

  // Delete a floor
  const deleteFloor = (floorNumber: string) => {
    if (floorNumber === floorPlan.floor) {
      alert('Cannot delete the currently active floor');
      return;
    }
    
    if (!confirm(`Are you sure you want to delete floor ${floorNumber}?`)) {
      return;
    }
    
    const updatedFloors = new Map(savedFloors);
    updatedFloors.delete(floorNumber);
    setSavedFloors(updatedFloors);
    
    const floorsObject = Object.fromEntries(updatedFloors);
    localStorage.setItem('floorPlans', JSON.stringify(floorsObject));
    
    const floors = Array.from(updatedFloors.keys()).sort((a, b) => parseInt(a) - parseInt(b));
    setAvailableFloors(floors);
  };

  // Export floor plan as JSON
  const exportFloorPlan = () => {
    try {
      const dataStr = JSON.stringify(floorPlan, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `floor-${floorPlan.building}-${floorPlan.floor}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting floor plan:', error);
      alert('Error exporting floor plan');
    }
  };

  // Export all floors as JSON
  const exportAllFloors = () => {
    try {
      // Save current floor first
      const updatedFloors = new Map(savedFloors);
      updatedFloors.set(floorPlan.floor, floorPlan);
      
      const allFloors = Object.fromEntries(updatedFloors);
      const dataStr = JSON.stringify(allFloors, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `all-floors-${floorPlan.building}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting all floors:', error);
      alert('Error exporting floors');
    }
  };

  // Import floor plan from JSON
  const importFloorPlan = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const imported = JSON.parse(content);
        
        // Check if it's a single floor or multiple floors
        if (imported.building && imported.floor) {
          // Single floor
          setFloorPlan(imported);
          saveCurrentFloor();
        } else {
          // Multiple floors
          const floorsMap = new Map<string, FloorPlan>(Object.entries(imported));
          setSavedFloors(floorsMap);
          localStorage.setItem('floorPlans', JSON.stringify(imported));
          setAvailableFloors(Array.from(floorsMap.keys()).sort((a, b) => parseInt(a) - parseInt(b)));
          
          // Load first floor
          const firstFloor = Array.from(floorsMap.keys())[0];
          if (firstFloor) {
            setFloorPlan(floorsMap.get(firstFloor)!);
          }
        }
        
        alert('Floor plan(s) imported successfully!');
      } catch (error) {
        console.error('Error importing floor plan:', error);
        alert('Error importing floor plan. Please check the file format.');
      }
    };
    reader.readAsText(file);
  };

  // Save to backend (for future API integration)
  const saveToBackend = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        alert('Please log in to save to the server');
        return;
      }

      // This endpoint needs to be created on the backend
      const response = await fetch(`${API_BASE_URL}/api/office/floor-plans`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(floorPlan)
      });

      if (response.ok) {
        alert('Floor plan saved to server successfully!');
      } else {
        throw new Error('Failed to save to server');
      }
    } catch (error) {
      console.error('Error saving to backend:', error);
      alert('Error saving to server. Saved locally instead.');
      saveCurrentFloor();
    }
  };

  // Elevator is always centered
  const getElevatorPosition = (): Position => {
    return { x: GRID_COLS / 2, y: GRID_ROWS / 2 };
  };

  // Helper function to convert screen coordinates to canvas grid coordinates
  const screenToGrid = (screenX: number, screenY: number): { gridX: number; gridY: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { gridX: 0, gridY: 0 };

    const rect = canvas.getBoundingClientRect();
    
    // Get mouse position relative to canvas element
    const canvasX = screenX - rect.left;
    const canvasY = screenY - rect.top;
    
    // Canvas rendering transformations (in order):
    // 1. ctx.translate(pan.x + CANVAS_WIDTH/2, pan.y + CANVAS_HEIGHT/2)
    // 2. ctx.rotate(rotation * PI/180)
    // 3. ctx.scale(zoom, zoom)
    // 4. ctx.translate(-CANVAS_WIDTH/2, -CANVAS_HEIGHT/2)
    //
    // To reverse, we need to undo in REVERSE order:
    
    // Step 1: Undo translate(-CANVAS_WIDTH/2, -CANVAS_HEIGHT/2)
    // This means we ADD the center back
    let x = canvasX + CANVAS_WIDTH / 2;
    let y = canvasY + CANVAS_HEIGHT / 2;
    
    // Step 2: Undo scale(zoom, zoom)
    // Divide by zoom
    x = x / zoom;
    y = y / zoom;
    
    // Step 3: Undo rotate(rotation)
    // Rotate by -rotation
    if (rotation !== 0) {
      const angleRad = -(rotation * Math.PI) / 180;
      const cos = Math.cos(angleRad);
      const sin = Math.sin(angleRad);
      const tempX = x * cos - y * sin;
      const tempY = x * sin + y * cos;
      x = tempX;
      y = tempY;
    }
    
    // Step 4: Undo translate(pan.x + CANVAS_WIDTH/2, pan.y + CANVAS_HEIGHT/2)
    // Subtract the translation
    x = x - (pan.x + CANVAS_WIDTH / 2);
    y = y - (pan.y + CANVAS_HEIGHT / 2);
    
    // Convert to grid coordinates
    const gridX = Math.floor(x / GRID_SIZE);
    const gridY = Math.floor(y / GRID_SIZE);
    
    return { gridX, gridY };
  };

  // Drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.save();

    // Apply transformations: pan, zoom, and rotation
    ctx.translate(pan.x + CANVAS_WIDTH / 2, pan.y + CANVAS_HEIGHT / 2);
    ctx.rotate((rotation * Math.PI) / 180); // Convert degrees to radians
    ctx.scale(zoom, zoom);
    ctx.translate(-CANVAS_WIDTH / 2, -CANVAS_HEIGHT / 2);

    // Draw grid
    drawGrid(ctx);

    // Draw region boundaries and labels
    drawRegions(ctx);

    // Draw windows on perimeter walls (after regions so they appear on top)
    drawWindows(ctx);

    // Draw elevator
    const elevatorPos = getElevatorPosition();
    drawElevator(ctx, elevatorPos);

    // Draw entrances - DISABLED: Only elevator entrance lanes are shown
    // drawEntrances(ctx);

    // Draw drawing elements
    floorPlan.drawings.forEach(element => {
      const isBeingDragged = isDragging && draggedDrawing?.id === element.id;
      drawDrawingElement(ctx, element, isBeingDragged);
    });

    // Draw items
    floorPlan.items.forEach(item => {
      const isBeingDragged = isDragging && draggedItem?.id === item.id;
      drawItem(ctx, item, item.id === selectedItem?.id, isBeingDragged);
    });

    ctx.restore();
  }, [floorPlan, selectedItem, selectedDrawingId, zoom, pan, rotation, isDragging, draggedItem, draggedDrawing, canvasSize]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Zoom controls
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoom(prev => Math.min(2, prev + 0.1));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoom(prev => Math.max(0.5, prev - 0.1));
      } else if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setZoom(1);
      }
      
      // Rotation controls
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        if (e.shiftKey) {
          // Shift+R: Counter-clockwise
          setRotation(prev => (prev - 90 + 360) % 360);
        } else {
          // R: Clockwise
          setRotation(prev => (prev + 90) % 360);
        }
      }
      
      // Reset rotation
      if (e.key === 'Escape') {
        setRotation(0);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const drawGrid = (ctx: CanvasRenderingContext2D) => {
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 0.5;

    for (let x = 0; x <= GRID_COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * GRID_SIZE, 0);
      ctx.lineTo(x * GRID_SIZE, GRID_ROWS * GRID_SIZE);
      ctx.stroke();
    }

    for (let y = 0; y <= GRID_ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * GRID_SIZE);
      ctx.lineTo(GRID_COLS * GRID_SIZE, y * GRID_SIZE);
      ctx.stroke();
    }
  };

  const drawWindows = (ctx: CanvasRenderingContext2D) => {
    // Get elevator zone center to calculate region positions
    const elevatorPos = getElevatorPosition();
    const elevatorCenterX = elevatorPos.x * GRID_SIZE;
    const elevatorCenterY = elevatorPos.y * GRID_SIZE;
    const wallThickness = 8;
    
    // Calculate region positions
    const nwWidth = floorPlan.regions['north-west'].width;
    const nwHeight = floorPlan.regions['north-west'].height;
    const neWidth = floorPlan.regions['north-east'].width;
    const neHeight = floorPlan.regions['north-east'].height;
    const swWidth = floorPlan.regions['south-west'].width;
    const swHeight = floorPlan.regions['south-west'].height;
    const seWidth = floorPlan.regions['south-east'].width;
    const seHeight = floorPlan.regions['south-east'].height;
    
    // Calculate region edges
    const nwLeft = elevatorCenterX - wallThickness / 2 - nwWidth;
    const nwTop = elevatorCenterY - wallThickness / 2 - nwHeight;
    const neLeft = elevatorCenterX + wallThickness / 2;
    const neTop = elevatorCenterY - wallThickness / 2 - neHeight;
    const swLeft = elevatorCenterX - wallThickness / 2 - swWidth;
    const swTop = elevatorCenterY + wallThickness / 2;
    const seLeft = elevatorCenterX + wallThickness / 2;
    const seTop = elevatorCenterY + wallThickness / 2;
    
    // Calculate building bounds
    const buildingLeft = Math.min(nwLeft, swLeft);
    const buildingRight = Math.max(neLeft + neWidth, seLeft + seWidth);
    const buildingTop = Math.min(nwTop, neTop);
    const buildingBottom = Math.max(swTop + swHeight, seTop + seHeight);
    
    const perimeterWallThickness = 12;
    const windowWidth = GRID_SIZE * 2;
    const windowHeight = GRID_SIZE * 0.8;
    const verticalWindowWidth = GRID_SIZE * 0.8;
    const verticalWindowHeight = GRID_SIZE * 2;
    const windowSpacing = GRID_SIZE * 3;
    const windowColor = '#60a5fa';
    const frameColor = '#1e3a8a';
    
    const drawWindow = (x: number, y: number, width: number, height: number, isVertical: boolean) => {
      // Window glass
      ctx.fillStyle = windowColor + '40';
      ctx.fillRect(x, y, width, height);
      
      // Window frame
      ctx.strokeStyle = frameColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);
      
      // Window divider
      ctx.beginPath();
      if (isVertical) {
        ctx.moveTo(x, y + height / 2);
        ctx.lineTo(x + width, y + height / 2);
      } else {
        ctx.moveTo(x + width / 2, y);
        ctx.lineTo(x + width / 2, y + height);
      }
      ctx.stroke();
    };
    
    // Draw windows on EXTERIOR face of outer perimeter walls based on building bounds
    
    // TOP WALL - continuous across entire building width (OUTSIDE the wall)
    const topWallY = buildingTop - perimeterWallThickness - windowHeight;
    for (let x = buildingLeft + GRID_SIZE; x < buildingRight - windowWidth; x += windowSpacing) {
      drawWindow(x, topWallY, windowWidth, windowHeight, false);
    }
    
    // BOTTOM WALL - continuous across entire building width (OUTSIDE the wall)
    const bottomWallY = buildingBottom + perimeterWallThickness;
    for (let x = buildingLeft + GRID_SIZE; x < buildingRight - windowWidth; x += windowSpacing) {
      drawWindow(x, bottomWallY, windowWidth, windowHeight, false);
    }
    
    // LEFT WALL - continuous across entire building height (OUTSIDE the wall)
    const leftWallX = buildingLeft - perimeterWallThickness - verticalWindowWidth;
    for (let y = buildingTop + GRID_SIZE; y < buildingBottom - verticalWindowHeight; y += windowSpacing) {
      drawWindow(leftWallX, y, verticalWindowWidth, verticalWindowHeight, true);
    }
    
    // RIGHT WALL - continuous across entire building height (OUTSIDE the wall)
    const rightWallX = buildingRight + perimeterWallThickness;
    for (let y = buildingTop + GRID_SIZE; y < buildingBottom - verticalWindowHeight; y += windowSpacing) {
      drawWindow(rightWallX, y, verticalWindowWidth, verticalWindowHeight, true);
    }
  };

  const drawRegions = (ctx: CanvasRenderingContext2D) => {
    const wallThickness = 8; // Wall thickness in pixels
    const wallColor = '#374151'; // Dark gray for walls
    const wallShadow = '#1f2937'; // Darker shadow for depth
    
    // Get elevator zone center (fixed center point)
    const elevatorPos = getElevatorPosition();
    const elevatorCenterX = elevatorPos.x * GRID_SIZE;
    const elevatorCenterY = elevatorPos.y * GRID_SIZE;
    
    // Calculate region positions based on their pixel dimensions
    const nwWidth = floorPlan.regions['north-west'].width;
    const nwHeight = floorPlan.regions['north-west'].height;
    const neWidth = floorPlan.regions['north-east'].width;
    const neHeight = floorPlan.regions['north-east'].height;
    const swWidth = floorPlan.regions['south-west'].width;
    const swHeight = floorPlan.regions['south-west'].height;
    const seWidth = floorPlan.regions['south-east'].width;
    const seHeight = floorPlan.regions['south-east'].height;
    
    // Calculate offsets from elevator center to region edges
    // North-West region: goes from elevator center minus its width/height
    const nwLeft = elevatorCenterX - wallThickness / 2 - nwWidth;
    const nwTop = elevatorCenterY - wallThickness / 2 - nwHeight;
    
    // North-East region: starts from elevator center plus wall
    const neLeft = elevatorCenterX + wallThickness / 2;
    const neTop = elevatorCenterY - wallThickness / 2 - neHeight;
    
    // South-West region: starts below elevator center
    const swLeft = elevatorCenterX - wallThickness / 2 - swWidth;
    const swTop = elevatorCenterY + wallThickness / 2;
    
    // South-East region: starts to the right and below elevator center
    const seLeft = elevatorCenterX + wallThickness / 2;
    const seTop = elevatorCenterY + wallThickness / 2;
    
    // Calculate outer perimeter bounds (furthest extents)
    const buildingLeft = Math.min(nwLeft, swLeft);
    const buildingRight = Math.max(neLeft + neWidth, seLeft + seWidth);
    const buildingTop = Math.min(nwTop, neTop);
    const buildingBottom = Math.max(swTop + swHeight, seTop + seHeight);
    
    // Define region boundaries
    const regions = {
      'north-west': {
        x: nwLeft,
        y: nwTop,
        width: nwWidth,
        height: nwHeight
      },
      'north-east': {
        x: neLeft,
        y: neTop,
        width: neWidth,
        height: neHeight
      },
      'south-west': {
        x: swLeft,
        y: swTop,
        width: swWidth,
        height: swHeight
      },
      'south-east': {
        x: seLeft,
        y: seTop,
        width: seWidth,
        height: seHeight
      }
    };
    
    // Draw outer perimeter walls that stretch to match building dimensions
    const perimeterWallThickness = 12;
    const drawPerimeterWall = (x: number, y: number, width: number, height: number) => {
      // Main wall
      ctx.fillStyle = '#2d3748';
      ctx.fillRect(x, y, width, height);
      
      // Shadow/depth effect
      ctx.fillStyle = '#1a202c';
      ctx.fillRect(x + width - 3, y, 3, height); // Right edge
      ctx.fillRect(x, y + height - 3, width, 3); // Bottom edge
      
      // Highlight
      ctx.fillStyle = '#4a5568';
      ctx.fillRect(x, y, width, 2); // Top highlight
      ctx.fillRect(x, y, 2, height); // Left highlight
      
      // Border
      ctx.strokeStyle = '#1a202c';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);
    };
    
    // Calculate total dimensions
    const totalWidth = buildingRight - buildingLeft;
    const totalHeight = buildingBottom - buildingTop;
    
    // Top perimeter wall (stretches with building)
    drawPerimeterWall(buildingLeft - perimeterWallThickness, buildingTop - perimeterWallThickness, totalWidth + perimeterWallThickness * 2, perimeterWallThickness);
    // Bottom perimeter wall (stretches with building)
    drawPerimeterWall(buildingLeft - perimeterWallThickness, buildingBottom, totalWidth + perimeterWallThickness * 2, perimeterWallThickness);
    // Left perimeter wall (stretches with building)
    drawPerimeterWall(buildingLeft - perimeterWallThickness, buildingTop, perimeterWallThickness, totalHeight);
    // Right perimeter wall (stretches with building)
    drawPerimeterWall(buildingRight, buildingTop, perimeterWallThickness, totalHeight);
    
    // Draw each region
    Object.entries(regions).forEach(([regionKey, bounds]) => {
      const config = floorPlan.regions[regionKey as Region];
      
      if (config.enabled) {
        // Draw region background
        ctx.fillStyle = config.color + '10';
        ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
        
        // Draw region border
        ctx.strokeStyle = config.color;
        ctx.lineWidth = 2;
        ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
        
        // Draw region label
        ctx.fillStyle = config.color;
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(
          config.label,
          bounds.x + bounds.width / 2,
          bounds.y + 25
        );
        
        // Draw dimensions label
        ctx.fillStyle = '#9ca3af';
        ctx.font = '10px Arial';
        ctx.fillText(
          `${bounds.width}×${bounds.height}px`,
          bounds.x + bounds.width / 2,
          bounds.y + 40
        );
      } else {
        // Greyed out disabled region
        ctx.fillStyle = '#1f293740';
        ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
        ctx.strokeStyle = '#4b5563';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
        ctx.setLineDash([]);
      }
    });
    
    // Draw walls between regions with 3D effect
    const drawWall = (x: number, y: number, width: number, height: number) => {
      // Main wall
      ctx.fillStyle = wallColor;
      ctx.fillRect(x, y, width, height);
      
      // Shadow/depth on right and bottom
      ctx.fillStyle = wallShadow;
      ctx.fillRect(x + width - 2, y, 2, height); // Right edge shadow
      ctx.fillRect(x, y + height - 2, width, 2); // Bottom edge shadow
      
      // Highlight on top and left
      ctx.fillStyle = '#4b5563';
      ctx.fillRect(x, y, width, 1); // Top highlight
      ctx.fillRect(x, y, 1, height); // Left highlight
      
      // Border
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, width, height);
    };
    
    // Vertical wall between NW/SW and NE/SE (through elevator center)
    const verticalWallX = elevatorCenterX - wallThickness / 2;
    drawWall(verticalWallX, buildingTop, wallThickness, totalHeight);
    
    // Horizontal wall between NW/NE and SW/SE (through elevator center)
    const horizontalWallY = elevatorCenterY - wallThickness / 2;
    drawWall(buildingLeft, horizontalWallY, totalWidth, wallThickness);
    
    // Draw center divider lines that go through the elevator zone center
    // These are FIXED at the elevator center and don't move
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 5]);
    
    // Vertical center line (fixed at elevator center X)
    ctx.beginPath();
    ctx.moveTo(elevatorCenterX, buildingTop - perimeterWallThickness);
    ctx.lineTo(elevatorCenterX, buildingBottom + perimeterWallThickness);
    ctx.stroke();
    
    // Horizontal center line (fixed at elevator center Y)
    ctx.beginPath();
    ctx.moveTo(buildingLeft - perimeterWallThickness, elevatorCenterY);
    ctx.lineTo(buildingRight + perimeterWallThickness, elevatorCenterY);
    ctx.stroke();
    
    ctx.setLineDash([]);
  };

  const drawElevator = (ctx: CanvasRenderingContext2D, pos: Position) => {
    const centerX = pos.x * GRID_SIZE;
    const centerY = pos.y * GRID_SIZE;
    const zoneSize = GRID_SIZE * floorPlan.elevatorZone.size; // Dynamic size based on configuration
    const gridCells = 5; // 5×5 positioning grid
    const cellSize = zoneSize / gridCells; // Cell size for elevator positioning
    
    // Draw elevator zone background
    ctx.fillStyle = '#1f293730';
    ctx.fillRect(centerX - zoneSize / 2, centerY - zoneSize / 2, zoneSize, zoneSize);
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = 2;
    ctx.strokeRect(centerX - zoneSize / 2, centerY - zoneSize / 2, zoneSize, zoneSize);

    // Draw region entrances on the elevator zone borders
    floorPlan.elevatorZone.entrances.forEach((entrance) => {
      const entranceWidth = GRID_SIZE * entrance.width;
      const entranceDepth = GRID_SIZE * 1.5;
      const isSelected = selectedEntranceId === entrance.id;
      
      let entranceX = 0, entranceY = 0, entranceW = 0, entranceH = 0;
      
      switch (entrance.side) {
        case 'north':
          // Position along north edge (position 0 = left, 1 = right)
          entranceX = centerX - zoneSize / 2 + (zoneSize * entrance.position) - entranceWidth / 2;
          entranceY = centerY - zoneSize / 2 - entranceDepth;
          entranceW = entranceWidth;
          entranceH = entranceDepth;
          break;
        case 'south':
          entranceX = centerX - zoneSize / 2 + (zoneSize * entrance.position) - entranceWidth / 2;
          entranceY = centerY + zoneSize / 2;
          entranceW = entranceWidth;
          entranceH = entranceDepth;
          break;
        case 'east':
          entranceX = centerX + zoneSize / 2;
          entranceY = centerY - zoneSize / 2 + (zoneSize * entrance.position) - entranceWidth / 2;
          entranceW = entranceDepth;
          entranceH = entranceWidth;
          break;
        case 'west':
          entranceX = centerX - zoneSize / 2 - entranceDepth;
          entranceY = centerY - zoneSize / 2 + (zoneSize * entrance.position) - entranceWidth / 2;
          entranceW = entranceDepth;
          entranceH = entranceWidth;
          break;
      }
      
      // Draw entrance lane with region color if connected
      const regionColor = entrance.targetRegion ? floorPlan.regions[entrance.targetRegion].color : '#10b981';
      ctx.fillStyle = isSelected ? `${regionColor}60` : `${regionColor}40`;
      ctx.fillRect(entranceX, entranceY, entranceW, entranceH);
      ctx.strokeStyle = isSelected ? '#22c55e' : regionColor;
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.strokeRect(entranceX, entranceY, entranceW, entranceH);
      
      // Draw stylized door design (instead of emoji)
      const doorCenterX = entranceX + entranceW / 2;
      const doorCenterY = entranceY + entranceH / 2;
      
      // Draw door frame
      ctx.strokeStyle = isSelected ? '#ffffff' : '#1f2937';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        doorCenterX - 8, 
        doorCenterY - 10, 
        16, 
        20
      );
      
      // Draw door panels (two rectangles)
      ctx.fillStyle = isSelected ? '#ffffff80' : '#37415180';
      ctx.fillRect(doorCenterX - 6, doorCenterY - 8, 12, 7);
      ctx.fillRect(doorCenterX - 6, doorCenterY + 1, 12, 7);
      
      // Draw door handle
      ctx.fillStyle = '#fbbf24'; // Gold/yellow handle
      ctx.beginPath();
      ctx.arc(doorCenterX + 4, doorCenterY, 1.5, 0, Math.PI * 2);
      ctx.fill();
      
      // Draw region label if connected
      if (entrance.targetRegion) {
        ctx.font = 'bold 8px Arial';
        ctx.fillStyle = '#ffffff';
        const regionLabel = floorPlan.regions[entrance.targetRegion].label;
        ctx.fillText(regionLabel, entranceX + entranceW / 2, entranceY + entranceH + 10);
      }
    });

    // Draw positioning grid lines (5×5 grid)
    ctx.strokeStyle = '#4b556320';
    ctx.lineWidth = 1;
    for (let i = 1; i < gridCells; i++) {
      // Vertical grid lines
      const x = centerX - zoneSize / 2 + i * cellSize;
      ctx.beginPath();
      ctx.moveTo(x, centerY - zoneSize / 2);
      ctx.lineTo(x, centerY + zoneSize / 2);
      ctx.stroke();
      
      // Horizontal grid lines
      const y = centerY - zoneSize / 2 + i * cellSize;
      ctx.beginPath();
      ctx.moveTo(centerX - zoneSize / 2, y);
      ctx.lineTo(centerX + zoneSize / 2, y);
      ctx.stroke();
    }

    // Draw each elevator
    const elevatorSize = GRID_SIZE * 3;
    
    floorPlan.elevators.forEach((elevator) => {
      // Calculate elevator position in grid
      const elevX = centerX - zoneSize / 2 + elevator.position.col * cellSize + cellSize / 2;
      const elevY = centerY - zoneSize / 2 + elevator.position.row * cellSize + cellSize / 2;
      const isSelected = selectedElevatorId === elevator.id;
      
      // Draw elevator shaft with selection highlighting
      ctx.fillStyle = isSelected ? '#4b5563' : '#374151';
      ctx.fillRect(elevX - elevatorSize / 2, elevY - elevatorSize / 2, elevatorSize, elevatorSize);
      
      // Border (green if selected)
      ctx.strokeStyle = isSelected ? '#22c55e' : '#9ca3af';
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.strokeRect(elevX - elevatorSize / 2, elevY - elevatorSize / 2, elevatorSize, elevatorSize);
      
      // Draw individual exit indicators for this elevator
      const exitRadius = 8;
      const exitDistance = elevatorSize / 2 + 12;
      
      elevator.exits.forEach((exit) => {
        let exitX = elevX;
        let exitY = elevY;
        
        switch (exit) {
          case 'north':
            exitY = elevY - exitDistance;
            break;
          case 'south':
            exitY = elevY + exitDistance;
            break;
          case 'east':
            exitX = elevX + exitDistance;
            break;
          case 'west':
            exitX = elevX - exitDistance;
            break;
        }
        
        // Draw exit circle
        ctx.fillStyle = '#10b98180';
        ctx.beginPath();
        ctx.arc(exitX, exitY, exitRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Draw stylized door for exit (smaller version)
        // Door frame
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(exitX - 4, exitY - 5, 8, 10);
        
        // Door panels
        ctx.fillStyle = '#ffffff60';
        ctx.fillRect(exitX - 3, exitY - 4, 6, 3.5);
        ctx.fillRect(exitX - 3, exitY + 0.5, 6, 3.5);
        
        // Door handle
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(exitX + 2, exitY, 1, 0, Math.PI * 2);
        ctx.fill();
      });
      
      // Draw elevator icon and ID
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('🛗', elevX, elevY);
      ctx.font = 'bold 8px Arial';
      ctx.fillText(`#${elevator.id}`, elevX, elevY + 12);
    });

    // Zone label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('ELEVATOR ZONE', centerX, centerY - zoneSize / 2 + 12);
    
    // Draw staircases in the elevator zone
    floorPlan.staircases.forEach((staircase) => {
      const stairX = centerX - zoneSize / 2 + staircase.position.col * cellSize + cellSize / 2;
      const stairY = centerY - zoneSize / 2 + staircase.position.row * cellSize + cellSize / 2;
      const stairWidth = cellSize * staircase.width;
      const stairHeight = cellSize * staircase.height;
      const isSelected = selectedStaircaseId === staircase.id;
      
      // Draw staircase background
      ctx.fillStyle = isSelected ? '#6366f1' : '#4f46e5';
      ctx.fillRect(stairX - stairWidth / 2, stairY - stairHeight / 2, stairWidth, stairHeight);
      
      // Border (green if selected)
      ctx.strokeStyle = isSelected ? '#22c55e' : '#818cf8';
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.strokeRect(stairX - stairWidth / 2, stairY - stairHeight / 2, stairWidth, stairHeight);
      
      // Draw entrance if configured
      if (staircase.entrance) {
        const entranceWidth = 8;
        const entranceHeight = 8;
        const entranceColor = '#10b981'; // Green for entrance
        const entranceOffset = 4; // Pixels from edge
        
        let entranceX = stairX;
        let entranceY = stairY;
        
        // Position entrance marker on the specified side
        switch (staircase.entrance.side) {
          case 'north':
            entranceX = stairX;
            entranceY = stairY - stairHeight / 2 - entranceOffset;
            // Draw entrance marker (door-like rectangle)
            ctx.fillStyle = entranceColor;
            ctx.fillRect(entranceX - entranceWidth / 2, entranceY - entranceHeight / 2, entranceWidth, entranceHeight);
            ctx.strokeStyle = '#065f46';
            ctx.lineWidth = 2;
            ctx.strokeRect(entranceX - entranceWidth / 2, entranceY - entranceHeight / 2, entranceWidth, entranceHeight);
            // Draw arrow pointing to entrance
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('↓', entranceX, entranceY + 3);
            break;
          case 'south':
            entranceX = stairX;
            entranceY = stairY + stairHeight / 2 + entranceOffset;
            ctx.fillStyle = entranceColor;
            ctx.fillRect(entranceX - entranceWidth / 2, entranceY - entranceHeight / 2, entranceWidth, entranceHeight);
            ctx.strokeStyle = '#065f46';
            ctx.lineWidth = 2;
            ctx.strokeRect(entranceX - entranceWidth / 2, entranceY - entranceHeight / 2, entranceWidth, entranceHeight);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('↑', entranceX, entranceY + 3);
            break;
          case 'east':
            entranceX = stairX + stairWidth / 2 + entranceOffset;
            entranceY = stairY;
            ctx.fillStyle = entranceColor;
            ctx.fillRect(entranceX - entranceWidth / 2, entranceY - entranceHeight / 2, entranceWidth, entranceHeight);
            ctx.strokeStyle = '#065f46';
            ctx.lineWidth = 2;
            ctx.strokeRect(entranceX - entranceWidth / 2, entranceY - entranceHeight / 2, entranceWidth, entranceHeight);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('←', entranceX, entranceY + 3);
            break;
          case 'west':
            entranceX = stairX - stairWidth / 2 - entranceOffset;
            entranceY = stairY;
            ctx.fillStyle = entranceColor;
            ctx.fillRect(entranceX - entranceWidth / 2, entranceY - entranceHeight / 2, entranceWidth, entranceHeight);
            ctx.strokeStyle = '#065f46';
            ctx.lineWidth = 2;
            ctx.strokeRect(entranceX - entranceWidth / 2, entranceY - entranceHeight / 2, entranceWidth, entranceHeight);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('→', entranceX, entranceY + 3);
            break;
        }
        
        // Draw connection line from entrance to target region if specified
        if (staircase.entrance.targetRegion) {
          ctx.strokeStyle = entranceColor + '80'; // Semi-transparent
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(entranceX, entranceY);
          
          // Draw line pointing toward the target region
          const lineLength = 30;
          switch (staircase.entrance.side) {
            case 'north':
              ctx.lineTo(entranceX, entranceY - lineLength);
              break;
            case 'south':
              ctx.lineTo(entranceX, entranceY + lineLength);
              break;
            case 'east':
              ctx.lineTo(entranceX + lineLength, entranceY);
              break;
            case 'west':
              ctx.lineTo(entranceX - lineLength, entranceY);
              break;
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      
      // Draw stair steps (multiple horizontal lines)
      ctx.strokeStyle = '#c7d2fe';
      ctx.lineWidth = 1.5;
      const numSteps = 5;
      for (let i = 1; i < numSteps; i++) {
        const stepY = stairY - stairHeight / 2 + (stairHeight / numSteps) * i;
        ctx.beginPath();
        ctx.moveTo(stairX - stairWidth / 2 + 5, stepY);
        ctx.lineTo(stairX + stairWidth / 2 - 5, stepY);
        ctx.stroke();
      }
      
      // Draw direction arrows
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      if (staircase.direction === 'up') {
        ctx.fillText('↑', stairX, stairY + 5);
      } else if (staircase.direction === 'down') {
        ctx.fillText('↓', stairX, stairY + 5);
      } else {
        ctx.fillText('⇅', stairX, stairY + 5);
      }
      
      // Staircase ID
      ctx.font = 'bold 8px Arial';
      ctx.fillText(`S#${staircase.id}`, stairX, stairY + 15);
    });
  };

  const drawEntrances = (ctx: CanvasRenderingContext2D) => {
    Object.entries(floorPlan.regions).forEach(([region, config]) => {
      if (!config.enabled || !config.hasEntrance) return; // Only show if enabled AND has entrance

      let x = 0, y = 0, width = 0, height = 0;

      switch (region as Region) {
        case 'north-west':
          // Top-left corner entrance
          x = 0;
          y = 0;
          width = 3 * GRID_SIZE;
          height = GRID_SIZE;
          break;
        case 'north-east':
          // Top-right corner entrance
          x = (GRID_COLS - 3) * GRID_SIZE;
          y = 0;
          width = 3 * GRID_SIZE;
          height = GRID_SIZE;
          break;
        case 'south-west':
          // Bottom-left corner entrance
          x = 0;
          y = (GRID_ROWS - 1) * GRID_SIZE;
          width = 3 * GRID_SIZE;
          height = GRID_SIZE;
          break;
        case 'south-east':
          // Bottom-right corner entrance
          x = (GRID_COLS - 3) * GRID_SIZE;
          y = (GRID_ROWS - 1) * GRID_SIZE;
          width = 3 * GRID_SIZE;
          height = GRID_SIZE;
          break;
      }

      // Entrance door
      ctx.fillStyle = '#10b981';
      ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = '#059669';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);

      // Door symbol
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('🚪', x + width / 2, y + height / 2 + 5);
    });
  };

  const drawItem = (ctx: CanvasRenderingContext2D, item: PlaceableItem, isSelected: boolean, isBeingDragged: boolean = false) => {
    const x = item.position.x * GRID_SIZE;
    const y = item.position.y * GRID_SIZE;
    const width = item.width * GRID_SIZE;
    const height = item.height * GRID_SIZE;

    // Background - more transparent when dragging
    const opacity = isBeingDragged ? '70' : '40';
    if (item.type === 'island') {
      ctx.fillStyle = item.status === 'available' ? `#3b82f6${opacity}` : 
                       item.status === 'booked' ? `#f59e0b${opacity}` : `#ef4444${opacity}`;
    } else {
      ctx.fillStyle = item.status === 'available' ? `#8b5cf6${opacity}` : 
                       item.status === 'booked' ? `#ec4899${opacity}` : `#64748b${opacity}`;
    }
    ctx.fillRect(x, y, width, height);

    // Add shadow effect when dragging
    if (isBeingDragged) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 3;
    }

    // Border - thicker when dragging
    ctx.strokeStyle = isBeingDragged ? '#22c55e' :
                      isSelected ? '#fbbf24' : 
                      item.type === 'island' ? '#3b82f6' : '#8b5cf6';
    ctx.lineWidth = isBeingDragged ? 4 : isSelected ? 3 : 2;
    ctx.strokeRect(x, y, width, height);

    // Reset shadow
    if (isBeingDragged) {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }

    // Icon and name
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    
    if (item.type === 'island') {
      ctx.fillText('🏝️ ' + item.name, x + width / 2, y + 15);
      ctx.font = '10px Arial';
      ctx.fillText(`${item.desks} desks`, x + width / 2, y + 30);
      
      // Features
      let featY = y + 45;
      if (item.has_monitors) {
        ctx.fillText('🖥️', x + 15, featY);
      }
      if (item.has_docking_stations) {
        ctx.fillText('🔌', x + 35, featY);
      }
      if (item.has_standing_desks) {
        ctx.fillText('⬆️', x + 55, featY);
      }
    } else {
      ctx.fillText('📹 ' + item.name, x + width / 2, y + 15);
      ctx.font = '10px Arial';
      ctx.fillText(`Cap: ${item.capacity}`, x + width / 2, y + 30);
      
      // Features
      let featY = y + 45;
      let featX = x + 10;
      if (item.has_projector) {
        ctx.fillText('📽️', featX, featY);
        featX += 20;
      }
      if (item.has_video_conference) {
        ctx.fillText('📹', featX, featY);
        featX += 20;
      }
      if (item.has_whiteboard) {
        ctx.fillText('📝', featX, featY);
        featX += 20;
      }
      if (item.has_phone) {
        ctx.fillText('📞', featX, featY);
      }
    }

    // Region label
    ctx.fillStyle = floorPlan.regions[item.region].color;
    ctx.font = 'bold 9px Arial';
    ctx.fillText(item.region.toUpperCase(), x + width / 2, y + height - 5);
  };

  const drawDrawingElement = (ctx: CanvasRenderingContext2D, element: DrawingElement, isBeingDragged: boolean = false) => {
    const x = element.position.col * GRID_SIZE;
    const y = element.position.row * GRID_SIZE;
    const width = element.width * GRID_SIZE;
    const height = element.height * GRID_SIZE;

    ctx.save();
    
    // Apply rotation if needed
    if (element.rotation !== 0) {
      ctx.translate(x + width / 2, y + height / 2);
      ctx.rotate((element.rotation * Math.PI) / 180);
      ctx.translate(-(x + width / 2), -(y + height / 2));
    }

    const isSelected = selectedDrawingId === element.id;
    
    // Add shadow effect when dragging
    if (isBeingDragged) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
      ctx.shadowBlur = 15;
      ctx.shadowOffsetX = 5;
      ctx.shadowOffsetY = 5;
    }

    switch (element.type) {
      case 'technical-room':
        // Technical room background
        ctx.fillStyle = '#fbbf2480'; // Orange/yellow transparent
        ctx.fillRect(x, y, width, height);
        
        // Border
        ctx.strokeStyle = isSelected ? '#22c55e' : '#f59e0b';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(x, y, width, height);
        
        // Icon and label
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('🔧', x + width / 2, y + height / 2 - 10);
        
        if (element.roomType) {
          ctx.font = '10px Arial';
          const roomTypeLabel = element.roomType.charAt(0).toUpperCase() + element.roomType.slice(1);
          ctx.fillText(roomTypeLabel, x + width / 2, y + height / 2 + 15);
        }
        
        if (element.label) {
          ctx.font = 'bold 9px Arial';
          ctx.fillText(element.label, x + width / 2, y + height - 8);
        }
        break;

      case 'wall':
        // Wall
        ctx.fillStyle = '#6b7280'; // Gray
        ctx.fillRect(x, y, width, height);
        
        // Border for selected
        if (isSelected) {
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 3;
          ctx.strokeRect(x, y, width, height);
        }
        
        // Brick pattern
        ctx.strokeStyle = '#4b5563';
        ctx.lineWidth = 1;
        const brickHeight = GRID_SIZE * 0.2;
        for (let by = y; by < y + height; by += brickHeight) {
          ctx.beginPath();
          ctx.moveTo(x, by);
          ctx.lineTo(x + width, by);
          ctx.stroke();
        }
        
        if (element.label) {
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 9px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(element.label, x + width / 2, y + height / 2);
        }
        break;

      case 'toilet':
        // Toilet background
        ctx.fillStyle = '#a78bfa80'; // Purple transparent
        ctx.fillRect(x, y, width, height);
        
        // Border
        ctx.strokeStyle = isSelected ? '#22c55e' : '#8b5cf6';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(x, y, width, height);
        
        // Icon
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        let toiletIcon = '🚻';
        if (element.toiletType === 'men') toiletIcon = '🚹';
        else if (element.toiletType === 'women') toiletIcon = '🚺';
        else if (element.toiletType === 'accessible') toiletIcon = '♿';
        
        ctx.fillText(toiletIcon, x + width / 2, y + height / 2 + 5);
        
        if (element.label) {
          ctx.fillStyle = '#000000';
          ctx.font = 'bold 9px Arial';
          ctx.fillText(element.label, x + width / 2, y + height - 8);
        }
        break;

      case 'emergency-exit':
        // Emergency exit background
        ctx.fillStyle = '#ef444480'; // Red transparent
        ctx.fillRect(x, y, width, height);
        
        // Border
        ctx.strokeStyle = isSelected ? '#22c55e' : '#dc2626';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(x, y, width, height);
        
        // Icon and text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('🚨', x + width / 2, y + height / 2 - 5);
        
        ctx.font = 'bold 8px Arial';
        ctx.fillText('EXIT', x + width / 2, y + height / 2 + 10);
        
        if (element.label) {
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 9px Arial';
          ctx.fillText(element.label, x + width / 2, y + height - 5);
        }
        break;

      case 'balcony':
        // Balcony background
        ctx.fillStyle = '#34d39980'; // Green transparent
        ctx.fillRect(x, y, width, height);
        
        // Border
        ctx.strokeStyle = isSelected ? '#22c55e' : '#10b981';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(x, y, width, height);
        
        // Diagonal lines pattern
        ctx.strokeStyle = '#059669';
        ctx.lineWidth = 1;
        for (let i = -height; i < width; i += GRID_SIZE / 2) {
          ctx.beginPath();
          ctx.moveTo(x + i, y + height);
          ctx.lineTo(x + i + height, y);
          ctx.stroke();
        }
        
        // Icon
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('🏡', x + width / 2, y + height / 2 + 5);
        
        if (element.label) {
          ctx.font = 'bold 9px Arial';
          ctx.fillText(element.label, x + width / 2, y + height - 8);
        }
        break;
    }

    ctx.restore();
  };

  // Handlers
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { gridX, gridY } = screenToGrid(e.clientX, e.clientY);

    // Check if clicked on an item FIRST (higher priority)
    const clicked = floorPlan.items.find(item =>
      gridX >= item.position.x && gridX < item.position.x + item.width &&
      gridY >= item.position.y && gridY < item.position.y + item.height
    );

    if (clicked) {
      setSelectedItem(clicked);
      setSelectedDrawingId(null);
      return;
    }

    // Check if clicked on a drawing element (check from end to prioritize top elements)
    // Use a minimum clickable size for thin elements (like walls)
    const clickedDrawing = [...floorPlan.drawings].reverse().find(element => {
      const col = element.position.col;
      const row = element.position.row;
      // Minimum clickable size of 1 grid cell for thin elements
      const clickWidth = Math.max(element.width, 1);
      const clickHeight = Math.max(element.height, 1);
      return gridX >= col && gridX < col + clickWidth &&
             gridY >= row && gridY < row + clickHeight;
    });

    if (clickedDrawing) {
      setSelectedDrawingId(clickedDrawing.id);
      setSelectedItem(null);
    } else {
      setSelectedItem(null);
      setSelectedDrawingId(null);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { gridX, gridY } = screenToGrid(e.clientX, e.clientY);
    
    console.log('=== MOUSE DOWN DEBUG ===');
    console.log('🖱️ Click at grid coordinates:', gridX, gridY);
    console.log('📋 Total items on canvas:', floorPlan.items.length);
    console.log('📐 Canvas state - Zoom:', zoom, 'Rotation:', rotation, 'Pan:', pan);
    console.log('⌨️ Shift key pressed:', e.shiftKey);
    console.log('🔒 Canvas locked:', isCanvasLocked);
    
    if (floorPlan.items.length > 0) {
      console.log('🔍 Items on canvas:');
      floorPlan.items.forEach(item => {
        console.log(`  - ${item.name}: pos [${item.position.x}, ${item.position.y}], size [${item.width}×${item.height}]`);
      });
    }

    // PRIORITY 1: If Shift is held, ALWAYS try to select objects (disable panning)
    const forceObjectSelection = e.shiftKey;
    
    // Check if clicked on an item FIRST (higher priority than drawing elements)
    const clicked = floorPlan.items.find(item => {
      const isInBounds = gridX >= item.position.x && gridX < item.position.x + item.width &&
                         gridY >= item.position.y && gridY < item.position.y + item.height;
      console.log(`🔍 Checking ${item.name}: [${item.position.x}-${item.position.x + item.width}, ${item.position.y}-${item.position.y + item.height}] vs click [${gridX}, ${gridY}] = ${isInBounds}`);
      return isInBounds;
    });

    if (clicked) {
      // Start dragging the item
      console.log('✅✅✅ FOUND AND SELECTING ITEM:', clicked.name);
      setDraggedItem(clicked);
      setIsDragging(true);
      setIsPanning(false); // Explicitly prevent panning
      setDragOffset({
        x: gridX - clicked.position.x,
        y: gridY - clicked.position.y
      });
      setSelectedItem(clicked);
      e.preventDefault(); // Prevent default behavior
      e.stopPropagation(); // Stop event propagation
      return;
    }

    console.log('❌ No item found at click position');

    // Check if clicked on a drawing element (check from end to prioritize top elements)
    // Use a minimum clickable size for thin elements (like walls)
    const clickedDrawing = [...floorPlan.drawings].reverse().find(element => {
      const col = element.position.col;
      const row = element.position.row;
      // Minimum clickable size of 1 grid cell for thin elements
      const clickWidth = Math.max(element.width, 1);
      const clickHeight = Math.max(element.height, 1);
      const isInBounds = gridX >= col && gridX < col + clickWidth &&
             gridY >= row && gridY < row + clickHeight;
      if (isInBounds) {
        console.log(`✅ Found ${element.type} at row:${row}, col:${col}, size:${element.width}×${element.height}`);
      }
      return isInBounds;
    });

    if (clickedDrawing) {
      // Start dragging the drawing element
      console.log('🎯 Starting drag of drawing element:', clickedDrawing.type);
      setDraggedDrawing(clickedDrawing);
      setIsDragging(true);
      setIsPanning(false); // Explicitly prevent panning
      setDragOffset({
        x: gridX - clickedDrawing.position.col,
        y: gridY - clickedDrawing.position.row
      });
      setSelectedDrawingId(clickedDrawing.id);
      e.preventDefault(); // Prevent default behavior
      e.stopPropagation(); // Stop event propagation
      return;
    }
    
    // Only start panning if:
    // 1. We didn't click on anything
    // 2. Canvas is not locked
    // 3. Shift key is NOT pressed (Shift forces object selection mode)
    if (!isCanvasLocked && !forceObjectSelection) {
      console.log('💨 No element clicked, starting pan');
      setIsPanning(true);
      setPanStart({
        x: e.clientX - pan.x,
        y: e.clientY - pan.y
      });
    } else if (forceObjectSelection) {
      console.log('⌨️ Shift key pressed - object selection mode (no pan)');
    } else {
      console.log('🔒 Canvas is locked - panning disabled');
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Handle canvas panning
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
      return;
    }

    // Handle drawing element dragging
    if (isDragging && draggedDrawing) {
      const { gridX, gridY } = screenToGrid(e.clientX, e.clientY);

      // Calculate new position
      const newCol = Math.max(0, Math.min(GRID_COLS - draggedDrawing.width, gridX - dragOffset.x));
      const newRow = Math.max(0, Math.min(GRID_ROWS - draggedDrawing.height, gridY - dragOffset.y));

      // Store position in ref for smooth animation
      dragPosRef.current = { x: newCol, y: newRow };

      // Use requestAnimationFrame for smooth updates
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      animationFrameRef.current = requestAnimationFrame(() => {
        if (!dragPosRef.current || !draggedDrawing) return;

        // Update drawing element position in state with sync
        updateFloorPlanWithSync(prev => ({
          ...prev,
          drawings: prev.drawings.map(element =>
            element.id === draggedDrawing.id
              ? { ...element, position: { row: dragPosRef.current!.y, col: dragPosRef.current!.x } }
              : element
          )
        }));

        // Update dragged drawing reference
        setDraggedDrawing(prev => prev ? { ...prev, position: { row: dragPosRef.current!.y, col: dragPosRef.current!.x } } : null);
      });
      return;
    }

    // Handle item dragging
    if (isDragging && draggedItem) {
      const { gridX, gridY } = screenToGrid(e.clientX, e.clientY);

      // Calculate new position
      const newX = Math.max(0, Math.min(GRID_COLS - draggedItem.width, gridX - dragOffset.x));
      const newY = Math.max(0, Math.min(GRID_ROWS - draggedItem.height, gridY - dragOffset.y));

      // Store position in ref for smooth animation
      dragPosRef.current = { x: newX, y: newY };

      // Use requestAnimationFrame for smooth updates
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      animationFrameRef.current = requestAnimationFrame(() => {
        if (!dragPosRef.current || !draggedItem) return;

        // Update item position in state
        setFloorPlan(prev => ({
          ...prev,
          items: prev.items.map(item =>
            item.id === draggedItem.id
              ? { ...item, position: dragPosRef.current! }
              : item
          )
        }));

        // Update dragged item reference
        setDraggedItem(prev => prev ? { ...prev, position: dragPosRef.current! } : null);
      });
    }
  };

  const handleMouseUp = () => {
    // Cancel any pending animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Stop panning
    setIsPanning(false);
    
    // Stop item dragging
    setIsDragging(false);
    dragPosRef.current = null;
    
    if (draggedItem) {
      setSelectedItem(draggedItem);
    }
    setDraggedItem(null);
    
    // Stop drawing element dragging
    if (draggedDrawing) {
      setSelectedDrawingId(draggedDrawing.id);
    }
    setDraggedDrawing(null);
  };

  const toggleRegion = (region: Region) => {
    setFloorPlan(prev => {
      const updated = {
        ...prev,
        regions: {
          ...prev.regions,
          [region]: {
            ...prev.regions[region],
            enabled: !prev.regions[region].enabled
          }
        }
      };
      
      // If sync is enabled, update all floors
      if (syncRegionsAcrossFloors) {
        syncFloorConfigToAllFloors(updated);
      }
      
      return updated;
    });
  };

  const toggleEntrance = (region: Region) => {
    setFloorPlan(prev => {
      const updated = {
        ...prev,
        regions: {
          ...prev.regions,
          [region]: {
            ...prev.regions[region],
            hasEntrance: !prev.regions[region].hasEntrance
          }
        }
      };
      
      // If sync is enabled, update all floors
      if (syncRegionsAcrossFloors) {
        syncFloorConfigToAllFloors(updated);
      }
      
      return updated;
    });
  };

  // Sync complete floor configuration to all floors (regions, elevators, staircases, zone, drawings)
  const syncFloorConfigToAllFloors = (floorConfig: FloorPlan) => {
    const updatedFloors = new Map(savedFloors);
    
    // Update all floors with the new configuration
    availableFloors.forEach((floorNumber) => {
      const existingFloor = updatedFloors.get(floorNumber);
      if (existingFloor) {
        updatedFloors.set(floorNumber, {
          ...existingFloor,
          regions: { ...floorConfig.regions },
          elevators: floorConfig.elevators.map(e => ({ ...e })),
          staircases: floorConfig.staircases.map(s => ({ ...s })),
          elevatorZone: {
            ...floorConfig.elevatorZone,
            entrances: floorConfig.elevatorZone.entrances.map(e => ({ ...e }))
          },
          drawings: (floorConfig.drawings || []).map(d => ({ ...d }))
        });
      }
    });
    
    setSavedFloors(updatedFloors);
    
    // Save to localStorage
    const floorsObject = Object.fromEntries(updatedFloors);
    localStorage.setItem('floorPlans', JSON.stringify(floorsObject));
  };

  // Handle region size changes with sync
  const updateRegionSize = (region: Region, dimension: 'width' | 'height', value: number) => {
    setFloorPlan(prev => {
      const updated = {
        ...prev,
        regions: {
          ...prev.regions,
          [region]: {
            ...prev.regions[region],
            [dimension]: value
          }
        }
      };
      
      // If sync is enabled, update all floors
      if (syncRegionsAcrossFloors) {
        syncFloorConfigToAllFloors(updated);
      }
      
      return updated;
    });
  };

  // Helper function to update floor plan with automatic sync
  const updateFloorPlanWithSync = (updater: (prev: FloorPlan) => FloorPlan) => {
    setFloorPlan(prev => {
      const updated = updater(prev);
      
      // If sync is enabled, update all floors
      if (syncRegionsAcrossFloors) {
        syncFloorConfigToAllFloors(updated);
      }
      
      return updated;
    });
  };

  const addItemToFloorPlan = (backendItem: any, type: 'island' | 'meeting-room', region: Region) => {
    const newItem: PlaceableItem = {
      id: `${type}-${Date.now()}`,
      type,
      backend_id: backendItem.id,
      name: backendItem.name,
      position: { x: 5, y: 5 }, // Default position
      width: type === 'island' ? 5 : 6,
      height: type === 'island' ? 3 : 4,
      region,
      status: backendItem.status || 'available',
      ...(type === 'island' ? {
        desks: backendItem.total_desks || 0,
        has_monitors: backendItem.has_monitors || false,
        has_docking_stations: backendItem.has_docking_stations || false,
        has_standing_desks: backendItem.has_standing_desks || false
      } : {
        capacity: backendItem.capacity || 0,
        has_projector: backendItem.has_projector || false,
        has_whiteboard: backendItem.has_whiteboard || false,
        has_video_conference: backendItem.has_video_conference || false,
        has_phone: backendItem.has_phone || false
      })
    };

    setFloorPlan(prev => ({
      ...prev,
      items: [...prev.items, newItem]
    }));
  };

  const removeItem = (id: string) => {
    setFloorPlan(prev => ({
      ...prev,
      items: prev.items.filter(item => item.id !== id)
    }));
    setSelectedItem(null);
  };

  return (
    <div className="flex h-full bg-gray-900">
      {/* Left Sidebar - Tabbed Interface */}
      <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col overflow-hidden">
        {/* Sidebar Header */}
        <div className="p-3 border-b border-gray-700">
          <h3 className="text-xs font-bold text-white mb-2">Floor Plan Settings</h3>
          
          {/* Building/Floor Info */}
          <div className="text-[10px] text-gray-400 mb-2">
            <Building2 className="inline mr-0.5" size={10} />
            {floorPlan.building} - Floor {floorPlan.floor}
          </div>

          {/* Floor Management - Moved Above Tabs */}
          <div className="mb-2 space-y-1 p-1 bg-gray-700/30 rounded">
            <button
              onClick={() => setShowFloorManager(!showFloorManager)}
              className="w-full px-1.5 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded flex items-center justify-center gap-0.5 text-[11px] font-bold"
              title="Manage Floors"
            >
              <Layers size={12} />
              Floors ({availableFloors.length})
            </button>
            
            {showFloorManager && (
              <div className="space-y-1 mt-1">
                <div className="text-[10px] text-gray-400 font-bold mb-0.5">Available:</div>
                <div className="grid grid-cols-3 gap-0.5 max-h-24 overflow-y-auto">
                  {availableFloors.map((floor) => (
                    <div key={floor} className="relative">
                      <button
                        onClick={() => switchToFloor(floor)}
                        className={`w-full px-1 py-0.5 rounded text-[10px] font-bold ${
                          floor === floorPlan.floor
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                      >
                        {floor}
                      </button>
                      {floor !== floorPlan.floor && (
                        <button
                          onClick={() => deleteFloor(floor)}
                          className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center text-white text-[10px]"
                          title="Delete floor"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                
                <div className="flex gap-0.5 mt-1">
                  <input
                    type="text"
                    value={newFloorNumber}
                    onChange={(e) => setNewFloorNumber(e.target.value)}
                    placeholder="Floor #"
                    className="flex-1 px-1 py-0.5 bg-gray-900 border border-gray-600 rounded text-white text-[10px]"
                  />
                  <button
                    onClick={addNewFloor}
                    className="px-1.5 py-0.5 bg-green-600 hover:bg-green-700 text-white rounded text-[10px] font-bold"
                  >
                    <Plus size={10} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Sync Settings - Moved Above Tabs */}
          {availableFloors.length > 1 && (
            <div className="mb-2 p-1.5 bg-gray-700/30 rounded">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] text-gray-300 font-medium">Sync All Floors</span>
                <button
                  onClick={() => setSyncRegionsAcrossFloors(!syncRegionsAcrossFloors)}
                  className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${
                    syncRegionsAcrossFloors
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                  title={syncRegionsAcrossFloors ? 'Configuration synced across all floors' : 'Click to sync configuration across all floors'}
                >
                  {syncRegionsAcrossFloors ? '🔗 Synced' : '🔓 Independent'}
                </button>
              </div>
              {syncRegionsAcrossFloors && (
                <div className="p-1 bg-blue-900/20 border border-blue-700/30 rounded">
                  <p className="text-[8px] text-blue-300">
                    ℹ️ All changes (regions, elevators, staircases, zone, drawings) will apply to all {availableFloors.length} floors
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setActiveTab('general')}
            className={`flex-1 px-1.5 py-2 text-[9px] font-bold transition-colors ${
              activeTab === 'general'
                ? 'bg-gray-700 text-white border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
            }`}
          >
            General
          </button>
          <button
            onClick={() => setActiveTab('elevators')}
            className={`flex-1 px-1.5 py-2 text-[9px] font-bold transition-colors ${
              activeTab === 'elevators'
                ? 'bg-gray-700 text-white border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
            }`}
          >
            Elevators
          </button>
          <button
            onClick={() => setActiveTab('staircases')}
            className={`flex-1 px-1.5 py-2 text-[9px] font-bold transition-colors ${
              activeTab === 'staircases'
                ? 'bg-gray-700 text-white border-b-2 border-indigo-500'
                : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
            }`}
          >
            Staircases
          </button>
          <button
            onClick={() => setActiveTab('zone')}
            className={`flex-1 px-1.5 py-2 text-[9px] font-bold transition-colors ${
              activeTab === 'zone'
                ? 'bg-gray-700 text-white border-b-2 border-purple-500'
                : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
            }`}
          >
            Zone
          </button>
          <button
            onClick={() => setActiveTab('drawings')}
            className={`flex-1 px-1.5 py-2 text-[9px] font-bold transition-colors ${
              activeTab === 'drawings'
                ? 'bg-gray-700 text-white border-b-2 border-green-500'
                : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
            }`}
          >
            Drawings
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-3">
          
          {/* GENERAL TAB */}
          {activeTab === 'general' && (
            <div className="space-y-2">
              {/* Save/Load Controls */}
              <div className="mb-2 space-y-1 p-1 bg-gray-700/30 rounded">
                <button
                  onClick={saveCurrentFloor}
                  className="w-full px-1.5 py-1 bg-green-600 hover:bg-green-700 text-white rounded flex items-center justify-center gap-1 text-[11px] font-bold"
                  title="Save Floor"
                >
                  <Save size={12} />
                  Save
                </button>
                
                <div className="flex gap-1">
                  <button
                    onClick={exportFloorPlan}
                    className="flex-1 px-1 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded flex items-center justify-center text-[10px]"
                    title="Export current floor"
                  >
                    <Download size={10} />
                  </button>
                  <button
                    onClick={exportAllFloors}
                    className="flex-1 px-1 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded flex items-center justify-center text-[10px]"
                    title="Export all floors"
                  >
                    <Layers size={10} />
                  </button>
                </div>
                
                <label className="w-full px-1 py-0.5 bg-purple-600 hover:bg-purple-700 text-white rounded flex items-center justify-center gap-0.5 text-[10px] cursor-pointer">
                  <Upload size={10} />
                  Import
                  <input
                    type="file"
                    accept=".json"
                    onChange={importFloorPlan}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Regions */}
              <div className="mb-2">
                <h4 className="text-[11px] font-bold text-white flex items-center gap-0.5 mb-1">
                  <Navigation size={12} />
                  Building Regions
                </h4>
                <div className="space-y-0.5">
                  {Object.entries(floorPlan.regions).map(([key, config]) => (
                    <div key={key} className="p-0.5 rounded bg-gray-700/30">
                      <label className="flex items-center gap-0.5 cursor-pointer mb-0.5">
                        <input
                          type="checkbox"
                          checked={config.enabled}
                          onChange={() => toggleRegion(key as Region)}
                          className="w-2 h-2"
                        />
                        <div 
                          className="w-2 h-2 rounded"
                          style={{ backgroundColor: config.color }}
                        />
                        <span className="text-white text-[10px] font-medium">{config.label}</span>
                      </label>
                      {config.enabled && (
                        <>
                          <label className="flex items-center gap-0.5 cursor-pointer ml-2 text-[10px] mb-0.5">
                            <input
                              type="checkbox"
                              checked={config.hasEntrance}
                              onChange={() => toggleEntrance(key as Region)}
                              className="w-1.5 h-1.5"
                            />
                            <DoorOpen size={10} className="text-green-400" />
                            <span className="text-gray-300 text-[9px]">Entrance</span>
                          </label>
                          
                          {/* Region Size Controls */}
                          <div className="ml-2 mt-0.5 space-y-0.5">
                            <div className="flex items-center gap-0.5">
                              <label className="text-[9px] text-gray-400 w-8">Width:</label>
                              <input
                                type="range"
                                min="400"
                                max="1500"
                                step="50"
                                value={config.width}
                                onChange={(e) => updateRegionSize(key as Region, 'width', parseInt(e.target.value))}
                                className="flex-1"
                              />
                              <span className="text-[9px] text-white w-10">{config.width}px</span>
                            </div>
                            <div className="flex items-center gap-0.5">
                              <label className="text-[9px] text-gray-400 w-8">Height:</label>
                              <input
                                type="range"
                                min="400"
                                max="1500"
                                step="50"
                                value={config.height}
                                onChange={(e) => updateRegionSize(key as Region, 'height', parseInt(e.target.value))}
                                className="flex-1"
                              />
                              <span className="text-[9px] text-white w-10">{config.height}px</span>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Add Items */}
              <div className="mb-2">
                <button
                  onClick={() => setShowAddModal(true)}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded flex items-center justify-center gap-2"
                >
                  <Plus size={18} />
                  Add Island/Room
                </button>
              </div>

              {/* Stats */}
              <div className="text-xs text-gray-400 space-y-1 p-2 bg-gray-700/30 rounded">
                <div className="font-bold text-white mb-1">Statistics</div>
                <div>Items: {floorPlan.items.length}</div>
                <div>Islands: {floorPlan.items.filter(i => i.type === 'island').length}</div>
                <div>Rooms: {floorPlan.items.filter(i => i.type === 'meeting-room').length}</div>
                <div>Elevators: {floorPlan.elevators.length}</div>
                <div>Staircases: {floorPlan.staircases.length}</div>
              </div>
            </div>
          )}

          {/* ELEVATORS TAB */}
          {activeTab === 'elevators' && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-bold text-white mb-1 flex items-center gap-0.5">
                <Building2 size={12} className="text-blue-400" />
                Elevator Configuration
              </h4>
              <div className="text-[9px] text-gray-400 mb-1">Elevators: {floorPlan.elevators.length} / 10</div>
              <div className="flex gap-1 mb-1">
                <button
                  onClick={() => {
                    if (floorPlan.elevators.length < 10) {
                      const usedPositions = new Set(
                        floorPlan.elevators.map(e => `${e.position.row}-${e.position.col}`)
                      );
                      let newRow = 2, newCol = 2;
                      for (let row = 0; row < 5; row++) {
                        for (let col = 0; col < 5; col++) {
                          if (!usedPositions.has(`${row}-${col}`)) {
                            newRow = row;
                            newCol = col;
                            break;
                          }
                        }
                        if (!usedPositions.has(`${newRow}-${newCol}`)) break;
                      }
                      const newId = String(Math.max(...floorPlan.elevators.map(e => parseInt(e.id)), 0) + 1);
                      updateFloorPlanWithSync(prev => ({
                        ...prev,
                        elevators: [
                          ...prev.elevators,
                          { id: newId, position: { row: newRow, col: newCol }, exits: ['north', 'south', 'east', 'west'] }
                        ]
                      }));
                      setSelectedElevatorId(newId);
                    }
                  }}
                  disabled={floorPlan.elevators.length >= 10}
                  className="flex-1 px-2 py-1 rounded text-[10px] font-medium bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500"
                >
                  + Add
                </button>
                <button
                  onClick={() => {
                    if (selectedElevatorId) {
                      updateFloorPlanWithSync(prev => ({
                        ...prev,
                        elevators: prev.elevators.filter(e => e.id !== selectedElevatorId)
                      }));
                      setSelectedElevatorId(null);
                    }
                  }}
                  disabled={!selectedElevatorId}
                  className="flex-1 px-2 py-1 rounded text-[10px] font-medium bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-700 disabled:text-gray-500"
                >
                  - Remove
                </button>
              </div>
              <div className="flex gap-0.5 flex-wrap mb-1">
                {floorPlan.elevators.map((elevator) => (
                  <button
                    key={elevator.id}
                    onClick={() => setSelectedElevatorId(elevator.id)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      selectedElevatorId === elevator.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    #{elevator.id}
                  </button>
                ))}
              </div>
              
              {/* Selected Elevator Edit Controls */}
              {selectedElevatorId && (() => {
                const elevator = floorPlan.elevators.find(e => e.id === selectedElevatorId);
                if (!elevator) return null;
                
                return (
                  <div className="mt-1 p-1.5 bg-gray-900/50 rounded border border-blue-600/30">
                    <div className="text-[9px] text-blue-300 font-bold mb-1">Edit Elevator #{elevator.id}</div>
                    
                    {/* Exits/Entrances */}
                    <div className="mb-1">
                      <label className="text-[8px] text-gray-400 mb-0.5 block">Exits/Entrances</label>
                      <div className="grid grid-cols-2 gap-0.5">
                        {(['north', 'south', 'east', 'west'] as const).map(side => (
                          <label key={side} className="flex items-center gap-0.5 text-[8px] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={elevator.exits.includes(side)}
                              onChange={(e) => {
                                const isChecked = e.target.checked;
                                updateFloorPlanWithSync(prev => ({
                                  ...prev,
                                  elevators: prev.elevators.map(elev =>
                                    elev.id === selectedElevatorId
                                      ? {
                                          ...elev,
                                          exits: isChecked
                                            ? [...elev.exits, side]
                                            : elev.exits.filter(s => s !== side)
                                        }
                                      : elev
                                  )
                                }));
                              }}
                              className="w-2 h-2"
                            />
                            <span className="text-gray-300 capitalize">{side}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    
                    {/* Position Controls */}
                    <div>
                      <label className="text-[8px] text-gray-400">Position: R{elevator.position.row}, C{elevator.position.col}</label>
                      <div className="grid grid-cols-3 gap-0.5 mt-0.5">
                        <div></div>
                        <button
                          onClick={() => {
                            if (elevator.position.row > 0) {
                              updateFloorPlanWithSync(prev => ({
                                ...prev,
                                elevators: prev.elevators.map(e =>
                                  e.id === selectedElevatorId
                                    ? { ...e, position: { ...e.position, row: e.position.row - 1 } }
                                    : e
                                )
                              }));
                            }
                          }}
                          disabled={elevator.position.row === 0}
                          className="px-1 py-0.5 rounded text-[9px] bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500"
                        >
                          ↑
                        </button>
                        <div></div>
                        
                        <button
                          onClick={() => {
                            if (elevator.position.col > 0) {
                              updateFloorPlanWithSync(prev => ({
                                ...prev,
                                elevators: prev.elevators.map(e =>
                                  e.id === selectedElevatorId
                                    ? { ...e, position: { ...e.position, col: e.position.col - 1 } }
                                    : e
                                )
                              }));
                            }
                          }}
                          disabled={elevator.position.col === 0}
                          className="px-1 py-0.5 rounded text-[9px] bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500"
                        >
                          ←
                        </button>
                        <div></div>
                        <button
                          onClick={() => {
                            if (elevator.position.col < 4) {
                              updateFloorPlanWithSync(prev => ({
                                ...prev,
                                elevators: prev.elevators.map(e =>
                                  e.id === selectedElevatorId
                                    ? { ...e, position: { ...e.position, col: e.position.col + 1 } }
                                    : e
                                )
                              }));
                            }
                          }}
                          disabled={elevator.position.col === 4}
                          className="px-1 py-0.5 rounded text-[9px] bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500"
                        >
                          →
                        </button>
                        
                        <div></div>
                        <button
                          onClick={() => {
                            if (elevator.position.row < 4) {
                              updateFloorPlanWithSync(prev => ({
                                ...prev,
                                elevators: prev.elevators.map(e =>
                                  e.id === selectedElevatorId
                                    ? { ...e, position: { ...e.position, row: e.position.row + 1 } }
                                    : e
                                )
                              }));
                            }
                          }}
                          disabled={elevator.position.row === 4}
                          className="px-1 py-0.5 rounded text-[9px] bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500"
                        >
                          ↓
                        </button>
                        <div></div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* STAIRCASES TAB */}
          {activeTab === 'staircases' && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-bold text-white mb-1 flex items-center gap-0.5">
                <Navigation size={12} className="text-indigo-400" />
                Staircases ({floorPlan.staircases.length}/10)
              </h4>
              <div className="flex gap-1 mb-1">
                <button
                  onClick={() => {
                    if (floorPlan.staircases.length >= 10) {
                      alert('Maximum 10 staircases allowed');
                      return;
                    }
                    const newId = (Math.max(0, ...floorPlan.staircases.map(s => parseInt(s.id))) + 1).toString();
                    updateFloorPlanWithSync(prev => ({
                      ...prev,
                      staircases: [...prev.staircases, { 
                        id: newId, 
                        position: { row: 0, col: 0 }, 
                        width: 2,
                        height: 1.5,
                        direction: 'both' as const
                      }]
                    }));
                    setSelectedStaircaseId(newId);
                  }}
                  className="flex-1 px-2 py-1 rounded text-[10px] font-medium bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  + Add
                </button>
                <button
                  onClick={() => {
                    if (!selectedStaircaseId) return;
                    updateFloorPlanWithSync(prev => ({
                      ...prev,
                      staircases: prev.staircases.filter(s => s.id !== selectedStaircaseId)
                    }));
                    setSelectedStaircaseId(null);
                  }}
                  disabled={!selectedStaircaseId}
                  className="flex-1 px-2 py-1 rounded text-[10px] font-medium bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-700 disabled:text-gray-500"
                >
                  - Remove
                </button>
              </div>
              <div className="space-y-0.5 mb-1">
                {floorPlan.staircases.map((staircase) => (
                  <button
                    key={staircase.id}
                    onClick={() => setSelectedStaircaseId(staircase.id)}
                    className={`w-full px-1.5 py-0.5 rounded text-[9px] text-left ${
                      selectedStaircaseId === staircase.id
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    #{staircase.id} - {staircase.direction === 'up' ? '↑ Up' : staircase.direction === 'down' ? '↓ Down' : '⇅ Both'}
                  </button>
                ))}
              </div>
              
              {/* Selected Staircase Edit Controls */}
              {selectedStaircaseId && (() => {
                const staircase = floorPlan.staircases.find(s => s.id === selectedStaircaseId);
                if (!staircase) return null;
                
                return (
                  <div className="mt-1 p-1.5 bg-gray-900/50 rounded border border-indigo-600/30">
                    <div className="text-[9px] text-indigo-300 font-bold mb-1">Edit Staircase #{staircase.id}</div>
                    
                    {/* Direction */}
                    <div className="mb-1">
                      <label className="text-[8px] text-gray-400">Direction</label>
                      <select
                        value={staircase.direction}
                        onChange={(e) => {
                          updateFloorPlanWithSync(prev => ({
                            ...prev,
                            staircases: prev.staircases.map(s =>
                              s.id === selectedStaircaseId
                                ? { ...s, direction: e.target.value as 'up' | 'down' | 'both' }
                                : s
                            )
                          }));
                        }}
                        className="w-full px-1.5 py-0.5 rounded text-[9px] bg-gray-700 text-white border border-gray-600"
                      >
                        <option value="up">↑ Up</option>
                        <option value="down">↓ Down</option>
                        <option value="both">⇅ Both</option>
                      </select>
                    </div>
                    
                    {/* Entrance Configuration */}
                    <div className="mb-1">
                      <label className="flex items-center gap-0.5 text-[8px] cursor-pointer mb-0.5">
                        <input
                          type="checkbox"
                          checked={!!staircase.entrance}
                          onChange={(e) => {
                            updateFloorPlanWithSync(prev => ({
                              ...prev,
                              staircases: prev.staircases.map(s =>
                                s.id === selectedStaircaseId
                                  ? {
                                      ...s,
                                      entrance: e.target.checked
                                        ? { side: 'north', targetRegion: null }
                                        : undefined
                                    }
                                  : s
                              )
                            }));
                          }}
                          className="w-2 h-2"
                        />
                        <DoorOpen size={10} className="text-green-400" />
                        <span className="text-gray-300">Has Entrance</span>
                      </label>
                      
                      {staircase.entrance && (
                        <div className="ml-2 mt-0.5 space-y-0.5 p-1 bg-gray-800/50 rounded">
                          {/* Entrance Side */}
                          <div>
                            <label className="text-[8px] text-gray-400">Entrance Side</label>
                            <select
                              value={staircase.entrance.side}
                              onChange={(e) => {
                                setFloorPlan(prev => ({
                                  ...prev,
                                  staircases: prev.staircases.map(s =>
                                    s.id === selectedStaircaseId && s.entrance
                                      ? {
                                          ...s,
                                          entrance: {
                                            ...s.entrance,
                                            side: e.target.value as 'north' | 'south' | 'east' | 'west'
                                          }
                                        }
                                      : s
                                  )
                                }));
                              }}
                              className="w-full px-1.5 py-0.5 rounded text-[9px] bg-gray-700 text-white border border-gray-600"
                            >
                              <option value="north">North</option>
                              <option value="south">South</option>
                              <option value="east">East</option>
                              <option value="west">West</option>
                            </select>
                          </div>
                          
                          {/* Target Region */}
                          <div>
                            <label className="text-[8px] text-gray-400">Target Region</label>
                            <select
                              value={staircase.entrance.targetRegion || ''}
                              onChange={(e) => {
                                const value = e.target.value as 'north-west' | 'north-east' | 'south-west' | 'south-east' | '';
                                setFloorPlan(prev => ({
                                  ...prev,
                                  staircases: prev.staircases.map(s =>
                                    s.id === selectedStaircaseId && s.entrance
                                      ? {
                                          ...s,
                                          entrance: {
                                            ...s.entrance,
                                            targetRegion: value === '' ? null : value
                                          }
                                        }
                                      : s
                                  )
                                }));
                              }}
                              className="w-full px-1.5 py-0.5 rounded text-[9px] bg-gray-700 text-white border border-gray-600"
                            >
                              <option value="">None</option>
                              <option value="north-west">North-West</option>
                              <option value="north-east">North-East</option>
                              <option value="south-west">South-West</option>
                              <option value="south-east">South-East</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* Width */}
                    <div className="mb-1">
                      <label className="text-[8px] text-gray-400">Width: {staircase.width} cell{staircase.width > 1 ? 's' : ''}</label>
                      <input
                        type="range"
                        min="1"
                        max="4"
                        step="1"
                        value={staircase.width}
                        onChange={(e) => {
                          setFloorPlan(prev => ({
                            ...prev,
                            staircases: prev.staircases.map(s =>
                              s.id === selectedStaircaseId
                                ? { ...s, width: parseInt(e.target.value) }
                                : s
                            )
                          }));
                        }}
                        className="w-full"
                      />
                    </div>
                    
                    {/* Height */}
                    <div className="mb-1">
                      <label className="text-[8px] text-gray-400">Height: {staircase.height.toFixed(1)}</label>
                      <input
                        type="range"
                        min="1"
                        max="3"
                        step="0.5"
                        value={staircase.height}
                        onChange={(e) => {
                          setFloorPlan(prev => ({
                            ...prev,
                            staircases: prev.staircases.map(s =>
                              s.id === selectedStaircaseId
                                ? { ...s, height: parseFloat(e.target.value) }
                                : s
                            )
                          }));
                        }}
                        className="w-full"
                      />
                    </div>
                    
                    {/* Position Controls */}
                    <div>
                      <label className="text-[8px] text-gray-400">Position: R{staircase.position.row}, C{staircase.position.col}</label>
                      <div className="grid grid-cols-3 gap-0.5 mt-0.5">
                        <div></div>
                        <button
                          onClick={() => {
                            if (staircase.position.row > 0) {
                              setFloorPlan(prev => ({
                                ...prev,
                                staircases: prev.staircases.map(s =>
                                  s.id === selectedStaircaseId
                                    ? { ...s, position: { ...s.position, row: s.position.row - 1 } }
                                    : s
                                )
                              }));
                            }
                          }}
                          disabled={staircase.position.row === 0}
                          className="px-1 py-0.5 rounded text-[9px] bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500"
                        >
                          ↑
                        </button>
                        <div></div>
                        
                        <button
                          onClick={() => {
                            if (staircase.position.col > 0) {
                              setFloorPlan(prev => ({
                                ...prev,
                                staircases: prev.staircases.map(s =>
                                  s.id === selectedStaircaseId
                                    ? { ...s, position: { ...s.position, col: s.position.col - 1 } }
                                    : s
                                )
                              }));
                            }
                          }}
                          disabled={staircase.position.col === 0}
                          className="px-1 py-0.5 rounded text-[9px] bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500"
                        >
                          ←
                        </button>
                        <div></div>
                        <button
                          onClick={() => {
                            if (staircase.position.col < 4) {
                              setFloorPlan(prev => ({
                                ...prev,
                                staircases: prev.staircases.map(s =>
                                  s.id === selectedStaircaseId
                                    ? { ...s, position: { ...s.position, col: s.position.col + 1 } }
                                    : s
                                )
                              }));
                            }
                          }}
                          disabled={staircase.position.col === 4}
                          className="px-1 py-0.5 rounded text-[9px] bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500"
                        >
                          →
                        </button>
                        
                        <div></div>
                        <button
                          onClick={() => {
                            if (staircase.position.row < 4) {
                              setFloorPlan(prev => ({
                                ...prev,
                                staircases: prev.staircases.map(s =>
                                  s.id === selectedStaircaseId
                                    ? { ...s, position: { ...s.position, row: s.position.row + 1 } }
                                    : s
                                )
                              }));
                            }
                          }}
                          disabled={staircase.position.row === 4}
                          className="px-1 py-0.5 rounded text-[9px] bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500"
                        >
                          ↓
                        </button>
                        <div></div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ELEVATOR ZONE TAB */}
          {activeTab === 'zone' && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-bold text-white mb-1 flex items-center gap-0.5">
                <Building2 size={12} className="text-purple-400" />
                Elevator Zone
              </h4>
              <div className="mb-1">
                <label className="text-[8px] text-gray-400">Zone Size: {floorPlan.elevatorZone.size}×{floorPlan.elevatorZone.size}</label>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={floorPlan.elevatorZone.size}
                  onChange={(e) => updateFloorPlanWithSync(prev => ({
                    ...prev,
                    elevatorZone: { ...prev.elevatorZone, size: parseInt(e.target.value) }
                  }))}
                  className="w-full"
                />
              </div>
              
              <div className="text-[9px] text-gray-400 mb-1">Entrances: {floorPlan.elevatorZone.entrances.length}</div>
              <div className="flex gap-1 mb-1">
                <button
                  onClick={() => {
                    const newId = String(Math.max(...floorPlan.elevatorZone.entrances.map(e => parseInt(e.id)), 0) + 1);
                    updateFloorPlanWithSync(prev => ({
                      ...prev,
                      elevatorZone: {
                        ...prev.elevatorZone,
                        entrances: [
                          ...prev.elevatorZone.entrances,
                          { id: newId, side: 'north', position: 0.5, width: 2, targetRegion: null, hasHallway: false }
                        ]
                      }
                    }));
                    setSelectedEntranceId(newId);
                  }}
                  className="flex-1 px-2 py-1 rounded text-[10px] font-medium bg-green-600 text-white hover:bg-green-700"
                >
                  + Add
                </button>
                <button
                  onClick={() => {
                    if (selectedEntranceId) {
                      updateFloorPlanWithSync(prev => ({
                        ...prev,
                        elevatorZone: {
                          ...prev.elevatorZone,
                          entrances: prev.elevatorZone.entrances.filter(e => e.id !== selectedEntranceId)
                        }
                      }));
                      setSelectedEntranceId(null);
                    }
                  }}
                  disabled={!selectedEntranceId}
                  className="flex-1 px-2 py-1 rounded text-[10px] font-medium bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-700 disabled:text-gray-500"
                >
                  - Remove
                </button>
              </div>
              
              <div className="space-y-0.5 mb-1">
                {floorPlan.elevatorZone.entrances.map((entrance) => (
                  <button
                    key={entrance.id}
                    onClick={() => setSelectedEntranceId(entrance.id)}
                    className={`w-full px-1.5 py-0.5 rounded text-[9px] text-left ${
                      selectedEntranceId === entrance.id
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    #{entrance.id} - {entrance.side.charAt(0).toUpperCase() + entrance.side.slice(1)}
                    {entrance.targetRegion && ` → ${entrance.targetRegion}`}
                  </button>
                ))}
              </div>
              
              {/* Selected Entrance Edit Controls */}
              {selectedEntranceId && (() => {
                const entrance = floorPlan.elevatorZone.entrances.find(e => e.id === selectedEntranceId);
                if (!entrance) return null;
                
                return (
                  <div className="mt-1 p-1.5 bg-gray-900/50 rounded border border-green-600/30">
                    <div className="text-[9px] text-green-300 font-bold mb-1">Edit Entrance #{entrance.id}</div>
                    
                    {/* Side Selection */}
                    <div className="mb-1">
                      <label className="text-[8px] text-gray-400">Zone Side</label>
                      <select
                        value={entrance.side}
                        onChange={(e) => {
                          setFloorPlan(prev => ({
                            ...prev,
                            elevatorZone: {
                              ...prev.elevatorZone,
                              entrances: prev.elevatorZone.entrances.map(en =>
                                en.id === selectedEntranceId
                                  ? { ...en, side: e.target.value as 'north' | 'south' | 'east' | 'west' }
                                  : en
                              )
                            }
                          }));
                        }}
                        className="w-full px-1.5 py-0.5 rounded text-[9px] bg-gray-700 text-white border border-gray-600"
                      >
                        <option value="north">North</option>
                        <option value="south">South</option>
                        <option value="east">East</option>
                        <option value="west">West</option>
                      </select>
                    </div>
                    
                    {/* Position Slider */}
                    <div className="mb-1">
                      <label className="text-[8px] text-gray-400">Position: {Math.round(entrance.position * 100)}%</label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={entrance.position}
                        onChange={(e) => {
                          setFloorPlan(prev => ({
                            ...prev,
                            elevatorZone: {
                              ...prev.elevatorZone,
                              entrances: prev.elevatorZone.entrances.map(en =>
                                en.id === selectedEntranceId
                                  ? { ...en, position: parseFloat(e.target.value) }
                                  : en
                              )
                            }
                          }));
                        }}
                        className="w-full"
                      />
                    </div>
                    
                    {/* Target Region */}
                    <div className="mb-1">
                      <label className="text-[8px] text-gray-400">Connects To</label>
                      <select
                        value={entrance.targetRegion || ''}
                        onChange={(e) => {
                          setFloorPlan(prev => ({
                            ...prev,
                            elevatorZone: {
                              ...prev.elevatorZone,
                              entrances: prev.elevatorZone.entrances.map(en =>
                                en.id === selectedEntranceId
                                  ? { ...en, targetRegion: (e.target.value || null) as Region | null }
                                  : en
                              )
                            }
                          }));
                        }}
                        className="w-full px-1.5 py-0.5 rounded text-[9px] bg-gray-700 text-white border border-gray-600"
                      >
                        <option value="">None</option>
                        <option value="north-west">North-West</option>
                        <option value="north-east">North-East</option>
                        <option value="south-west">South-West</option>
                        <option value="south-east">South-East</option>
                      </select>
                    </div>
                    
                    {/* Width */}
                    <div>
                      <label className="text-[8px] text-gray-400">Width: {entrance.width} cells</label>
                      <input
                        type="range"
                        min="1"
                        max="4"
                        step="0.5"
                        value={entrance.width}
                        onChange={(e) => {
                          setFloorPlan(prev => ({
                            ...prev,
                            elevatorZone: {
                              ...prev.elevatorZone,
                              entrances: prev.elevatorZone.entrances.map(en =>
                                en.id === selectedEntranceId
                                  ? { ...en, width: parseFloat(e.target.value) }
                                  : en
                              )
                            }
                          }));
                        }}
                        className="w-full"
                      />
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* DRAWINGS TAB */}
          {activeTab === 'drawings' && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-bold text-white mb-1 flex items-center gap-0.5">
                <Grid3x3 size={12} className="text-green-400" />
                Drawing Elements ({floorPlan.drawings.length})
              </h4>

              {/* Element Type Selector */}
              <div className="mb-2">
                <label className="text-[9px] text-gray-400 mb-1 block">Add Element Type</label>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    onClick={() => {
                      const newId = (Math.max(0, ...floorPlan.drawings.map(d => parseInt(d.id))) + 1).toString();
                      updateFloorPlanWithSync(prev => ({
                        ...prev,
                        drawings: [...prev.drawings, {
                          id: newId,
                          type: 'technical-room',
                          position: { row: 0, col: 0 },
                          width: 3,
                          height: 3,
                          rotation: 0,
                          roomType: 'electrical'
                        }]
                      }));
                      setSelectedDrawingId(newId);
                    }}
                    className="px-2 py-1.5 rounded text-[9px] font-medium bg-blue-600 text-white hover:bg-blue-700"
                  >
                    🔧 Technical Room
                  </button>
                  <button
                    onClick={() => {
                      const newId = (Math.max(0, ...floorPlan.drawings.map(d => parseInt(d.id))) + 1).toString();
                      updateFloorPlanWithSync(prev => ({
                        ...prev,
                        drawings: [...prev.drawings, {
                          id: newId,
                          type: 'wall',
                          position: { row: 0, col: 0 },
                          width: 5,
                          height: 0.2,
                          rotation: 0,
                          orientation: 'horizontal'
                        }]
                      }));
                      setSelectedDrawingId(newId);
                    }}
                    className="px-2 py-1.5 rounded text-[9px] font-medium bg-gray-600 text-white hover:bg-gray-700"
                  >
                    🧱 Wall
                  </button>
                  <button
                    onClick={() => {
                      const newId = (Math.max(0, ...floorPlan.drawings.map(d => parseInt(d.id))) + 1).toString();
                      updateFloorPlanWithSync(prev => ({
                        ...prev,
                        drawings: [...prev.drawings, {
                          id: newId,
                          type: 'toilet',
                          position: { row: 0, col: 0 },
                          width: 2,
                          height: 2,
                          rotation: 0,
                          toiletType: 'unisex'
                        }]
                      }));
                      setSelectedDrawingId(newId);
                    }}
                    className="px-2 py-1.5 rounded text-[9px] font-medium bg-purple-600 text-white hover:bg-purple-700"
                  >
                    🚻 Toilet
                  </button>
                  <button
                    onClick={() => {
                      const newId = (Math.max(0, ...floorPlan.drawings.map(d => parseInt(d.id))) + 1).toString();
                      updateFloorPlanWithSync(prev => ({
                        ...prev,
                        drawings: [...prev.drawings, {
                          id: newId,
                          type: 'emergency-exit',
                          position: { row: 0, col: 0 },
                          width: 1.5,
                          height: 0.3,
                          rotation: 0
                        }]
                      }));
                      setSelectedDrawingId(newId);
                    }}
                    className="px-2 py-1.5 rounded text-[9px] font-medium bg-red-600 text-white hover:bg-red-700"
                  >
                    🚨 Emergency Exit
                  </button>
                  <button
                    onClick={() => {
                      const newId = (Math.max(0, ...floorPlan.drawings.map(d => parseInt(d.id))) + 1).toString();
                      updateFloorPlanWithSync(prev => ({
                        ...prev,
                        drawings: [...prev.drawings, {
                          id: newId,
                          type: 'balcony',
                          position: { row: 0, col: 0 },
                          width: 4,
                          height: 2,
                          rotation: 0
                        }]
                      }));
                      setSelectedDrawingId(newId);
                    }}
                    className="px-2 py-1.5 rounded text-[9px] font-medium bg-green-600 text-white hover:bg-green-700"
                  >
                    🏡 Balcony
                  </button>
                </div>
              </div>

              {/* Drawing Elements List */}
              <div className="space-y-0.5 mb-2">
                <div className="text-[9px] text-gray-400 mb-1">Placed Elements:</div>
                {floorPlan.drawings.length === 0 ? (
                  <div className="text-[8px] text-gray-500 italic p-2 bg-gray-900/30 rounded">
                    No drawing elements yet. Click buttons above to add.
                  </div>
                ) : (
                  floorPlan.drawings.map((drawing) => (
                    <div key={drawing.id} className="flex items-center gap-1">
                      <button
                        onClick={() => setSelectedDrawingId(drawing.id)}
                        className={`flex-1 px-1.5 py-0.5 rounded text-[9px] text-left ${
                          selectedDrawingId === drawing.id
                            ? 'bg-green-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                      >
                        {drawing.type === 'technical-room' && '🔧'}
                        {drawing.type === 'wall' && '🧱'}
                        {drawing.type === 'toilet' && '🚻'}
                        {drawing.type === 'emergency-exit' && '🚨'}
                        {drawing.type === 'balcony' && '🏡'}
                        {' '}
                        {drawing.type.replace('-', ' ').toUpperCase()} #{drawing.id}
                      </button>
                      <button
                        onClick={() => {
                          updateFloorPlanWithSync(prev => ({
                            ...prev,
                            drawings: prev.drawings.filter(d => d.id !== drawing.id)
                          }));
                          if (selectedDrawingId === drawing.id) {
                            setSelectedDrawingId(null);
                          }
                        }}
                        className="px-1.5 py-0.5 rounded text-[9px] bg-red-600 hover:bg-red-700 text-white"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Selected Drawing Edit Controls */}
              {selectedDrawingId && (() => {
                const drawing = floorPlan.drawings.find(d => d.id === selectedDrawingId);
                if (!drawing) return null;

                return (
                  <div className="mt-2 p-1.5 bg-gray-900/50 rounded border border-green-600/30">
                    <div className="text-[9px] text-green-300 font-bold mb-1">
                      Edit {drawing.type.replace('-', ' ').toUpperCase()} #{drawing.id}
                    </div>

                    {/* Position */}
                    <div className="mb-1">
                      <label className="text-[8px] text-gray-400">Position: R{drawing.position.row}, C{drawing.position.col}</label>
                      <div className="grid grid-cols-2 gap-0.5 mt-0.5">
                        <div>
                          <input
                            type="number"
                            value={drawing.position.row}
                            onChange={(e) => {
                              updateFloorPlanWithSync(prev => ({
                                ...prev,
                                drawings: prev.drawings.map(d =>
                                  d.id === selectedDrawingId
                                    ? { ...d, position: { ...d.position, row: parseInt(e.target.value) || 0 } }
                                    : d
                                )
                              }));
                            }}
                            className="w-full px-1 py-0.5 rounded text-[9px] bg-gray-700 text-white border border-gray-600"
                            placeholder="Row"
                          />
                        </div>
                        <div>
                          <input
                            type="number"
                            value={drawing.position.col}
                            onChange={(e) => {
                              updateFloorPlanWithSync(prev => ({
                                ...prev,
                                drawings: prev.drawings.map(d =>
                                  d.id === selectedDrawingId
                                    ? { ...d, position: { ...d.position, col: parseInt(e.target.value) || 0 } }
                                    : d
                                )
                              }));
                            }}
                            className="w-full px-1 py-0.5 rounded text-[9px] bg-gray-700 text-white border border-gray-600"
                            placeholder="Col"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Dimensions */}
                    <div className="mb-1">
                      <label className="text-[8px] text-gray-400">Size: {drawing.width} × {drawing.height} cells</label>
                      <div className="grid grid-cols-2 gap-0.5 mt-0.5">
                        <div>
                          <input
                            type="number"
                            step="0.1"
                            value={drawing.width}
                            onChange={(e) => {
                              updateFloorPlanWithSync(prev => ({
                                ...prev,
                                drawings: prev.drawings.map(d =>
                                  d.id === selectedDrawingId
                                    ? { ...d, width: parseFloat(e.target.value) || 1 }
                                    : d
                                )
                              }));
                            }}
                            className="w-full px-1 py-0.5 rounded text-[9px] bg-gray-700 text-white border border-gray-600"
                            placeholder="Width"
                          />
                        </div>
                        <div>
                          <input
                            type="number"
                            step="0.1"
                            value={drawing.height}
                            onChange={(e) => {
                              updateFloorPlanWithSync(prev => ({
                                ...prev,
                                drawings: prev.drawings.map(d =>
                                  d.id === selectedDrawingId
                                    ? { ...d, height: parseFloat(e.target.value) || 1 }
                                    : d
                                )
                              }));
                            }}
                            className="w-full px-1 py-0.5 rounded text-[9px] bg-gray-700 text-white border border-gray-600"
                            placeholder="Height"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Rotation */}
                    <div className="mb-1">
                      <label className="text-[8px] text-gray-400">Rotation: {drawing.rotation}°</label>
                      <select
                        value={drawing.rotation}
                        onChange={(e) => {
                          updateFloorPlanWithSync(prev => ({
                            ...prev,
                            drawings: prev.drawings.map(d =>
                              d.id === selectedDrawingId
                                ? { ...d, rotation: parseInt(e.target.value) as 0 | 90 | 180 | 270 }
                                : d
                            )
                          }));
                        }}
                        className="w-full px-1.5 py-0.5 rounded text-[9px] bg-gray-700 text-white border border-gray-600"
                      >
                        <option value="0">0° (Normal)</option>
                        <option value="90">90° (Right)</option>
                        <option value="180">180° (Upside Down)</option>
                        <option value="270">270° (Left)</option>
                      </select>
                    </div>

                    {/* Technical Room Type */}
                    {drawing.type === 'technical-room' && drawing.roomType && (
                      <div className="mb-1">
                        <label className="text-[8px] text-gray-400">Room Type</label>
                        <select
                          value={drawing.roomType}
                          onChange={(e) => {
                            updateFloorPlanWithSync(prev => ({
                              ...prev,
                              drawings: prev.drawings.map(d =>
                                d.id === selectedDrawingId
                                  ? { ...d, roomType: e.target.value as any }
                                  : d
                              )
                            }));
                          }}
                          className="w-full px-1.5 py-0.5 rounded text-[9px] bg-gray-700 text-white border border-gray-600"
                        >
                          <option value="electrical">⚡ Electrical</option>
                          <option value="mechanical">⚙️ Mechanical</option>
                          <option value="server">🖥️ Server</option>
                          <option value="storage">📦 Storage</option>
                          <option value="janitor">🧹 Janitor</option>
                        </select>
                      </div>
                    )}

                    {/* Toilet Type */}
                    {drawing.type === 'toilet' && drawing.toiletType && (
                      <div className="mb-1">
                        <label className="text-[8px] text-gray-400">Toilet Type</label>
                        <select
                          value={drawing.toiletType}
                          onChange={(e) => {
                            updateFloorPlanWithSync(prev => ({
                              ...prev,
                              drawings: prev.drawings.map(d =>
                                d.id === selectedDrawingId
                                  ? { ...d, toiletType: e.target.value as any }
                                  : d
                              )
                            }));
                          }}
                          className="w-full px-1.5 py-0.5 rounded text-[9px] bg-gray-700 text-white border border-gray-600"
                        >
                          <option value="men">🚹 Men</option>
                          <option value="women">🚺 Women</option>
                          <option value="accessible">♿ Accessible</option>
                          <option value="unisex">🚻 Unisex</option>
                        </select>
                      </div>
                    )}

                    {/* Label */}
                    <div className="mb-1">
                      <label className="text-[8px] text-gray-400">Label (Optional)</label>
                      <input
                        type="text"
                        value={drawing.label || ''}
                        onChange={(e) => {
                          updateFloorPlanWithSync(prev => ({
                            ...prev,
                            drawings: prev.drawings.map(d =>
                              d.id === selectedDrawingId
                                ? { ...d, label: e.target.value }
                                : d
                            )
                          }));
                        }}
                        className="w-full px-1.5 py-0.5 rounded text-[9px] bg-gray-700 text-white border border-gray-600"
                        placeholder="Optional label"
                      />
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          
        </div>

        {/* Keyboard Shortcuts - Always visible at bottom */}
        <div className="p-3 border-t border-gray-700">
          <h4 className="text-xs font-bold text-white mb-2">Shortcuts</h4>
          <div className="text-[9px] text-gray-400 space-y-1">
            <div><kbd className="px-1 py-0.5 bg-gray-700 rounded">Drag</kbd> Pan</div>
            <div><kbd className="px-1 py-0.5 bg-gray-700 rounded">+/-</kbd> Zoom</div>
            <div><kbd className="px-1 py-0.5 bg-gray-700 rounded">R</kbd> Rotate</div>
          </div>
        </div>
      </div>

      {/* Main Content Area - Canvas and Properties */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Canvas Toolbar */}
        <div className="bg-gray-800 border-b border-gray-700 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            {/* Zoom Controls */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold text-white">Zoom</span>
              <button
                onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
                className="px-1.5 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded"
                title="Zoom Out"
              >
                <ZoomOut size={10} />
              </button>
              <span className="px-2 py-1 bg-gray-700 text-white rounded text-[9px] min-w-[50px] text-center font-medium">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom(Math.min(4, zoom + 0.1))}
                className="px-1.5 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded"
                title="Zoom In"
              >
                <ZoomIn size={10} />
              </button>
              <button
                onClick={() => setZoom(1)}
                className="px-1.5 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-[8px]"
                title="Reset Zoom"
              >
                100%
              </button>
              <button
                onClick={() => setPan({ x: 0, y: 0 })}
                className="px-1.5 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-[8px]"
                title="Reset Pan"
              >
                Pan
              </button>
            </div>

            {/* Rotation Controls */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold text-white">Rotate</span>
              <button
                onClick={() => setRotation((rotation - 90 + 360) % 360)}
                className="px-1.5 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded"
                title="Rotate Counter-Clockwise"
              >
                <RotateCcw size={10} />
              </button>
              <span className="px-2 py-1 bg-gray-700 text-white rounded text-[9px] min-w-[40px] text-center font-medium">
                {rotation}°
              </span>
              <button
                onClick={() => setRotation((rotation + 90) % 360)}
                className="px-1.5 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded"
                title="Rotate Clockwise"
              >
                <RotateCw size={10} />
              </button>
              <button
                onClick={() => setRotation(0)}
                className="px-1.5 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-[8px]"
                title="Reset Rotation"
              >
                0°
              </button>
            </div>

            {/* Canvas Lock Toggle */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setIsCanvasLocked(!isCanvasLocked)}
                className={`px-2 py-1 rounded text-[8px] font-medium flex items-center gap-1 transition-colors ${
                  isCanvasLocked
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
                title={isCanvasLocked ? 'Canvas Locked - Click to Unlock' : 'Canvas Unlocked - Click to Lock'}
              >
                {isCanvasLocked ? (
                  <>
                    <Lock size={11} />
                    Locked
                  </>
                ) : (
                  <>
                    <Unlock size={11} />
                    Unlocked
                  </>
                )}
              </button>
            </div>

            {/* Canvas Size Controls */}
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="text-[9px] font-bold text-white whitespace-nowrap">Size</span>
              <div className="flex items-center gap-1">
                <label className="text-[8px] text-gray-400 font-medium">W:</label>
                <input
                  type="range"
                  min="800"
                  max="4000"
                  step="100"
                  value={canvasSize.width}
                  onChange={(e) => setCanvasSize(prev => ({ ...prev, width: parseInt(e.target.value) }))}
                  className="w-20"
                />
                <span className="text-[8px] text-white w-12 font-medium">{canvasSize.width}px</span>
              </div>
              <div className="flex items-center gap-1">
                <label className="text-[8px] text-gray-400 font-medium">H:</label>
                <input
                  type="range"
                  min="600"
                  max="4000"
                  step="100"
                  value={canvasSize.height}
                  onChange={(e) => setCanvasSize(prev => ({ ...prev, height: parseInt(e.target.value) }))}
                  className="w-20"
                />
                <span className="text-[8px] text-white w-12 font-medium">{canvasSize.height}px</span>
              </div>
              <button
                onClick={() => setCanvasSize({ width: 2000, height: 2000 })}
                className="px-1.5 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-[8px] whitespace-nowrap"
                title="Reset to Default"
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 flex items-start justify-center pt-2 px-2 bg-gray-900 overflow-auto">
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onClick={handleCanvasClick}
            className={`border border-gray-700 rounded ${
              isPanning ? 'cursor-grabbing' : 
              isDragging ? 'cursor-move' : 
              'cursor-grab'
            }`}
            style={{ maxWidth: '100%', height: 'auto' }}
          />
        </div>

        {/* Properties Panel - Below Canvas */}
        <div className="bg-gray-800 border-t border-gray-700 p-2 max-h-48 overflow-y-auto">
          <h3 className="text-sm font-bold text-white mb-2">Properties</h3>
        
        {selectedItem ? (
          <div className="space-y-4">
            <div>
              <div className="text-sm text-gray-400">Type</div>
              <div className="text-lg text-white font-bold">
                {selectedItem.type === 'island' ? '🏝️ Island' : '📹 Meeting Room'}
              </div>
            </div>
            
            <div>
              <div className="text-sm text-gray-400">Name</div>
              <div className="text-base text-white">{selectedItem.name}</div>
            </div>

            <div>
              <div className="text-sm text-gray-400">Region</div>
              <div 
                className="text-base text-white font-bold"
                style={{ color: floorPlan.regions[selectedItem.region].color }}
              >
                {selectedItem.region.toUpperCase()}
              </div>
            </div>

            {/* Position Controls */}
            <div>
              <div className="text-sm text-gray-400 mb-2">Position (Grid Cells)</div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-gray-500">X</label>
                  <input
                    type="number"
                    min="0"
                    max={GRID_COLS - selectedItem.width}
                    value={selectedItem.position.x}
                    onChange={(e) => {
                      const newX = parseInt(e.target.value) || 0;
                      setFloorPlan(prev => ({
                        ...prev,
                        items: prev.items.map(item =>
                          item.id === selectedItem.id
                            ? { ...item, position: { ...item.position, x: Math.max(0, Math.min(GRID_COLS - item.width, newX)) } }
                            : item
                        )
                      }));
                      setSelectedItem(prev => prev ? { ...prev, position: { ...prev.position, x: Math.max(0, Math.min(GRID_COLS - prev.width, newX)) } } : null);
                    }}
                    className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-500">Y</label>
                  <input
                    type="number"
                    min="0"
                    max={GRID_ROWS - selectedItem.height}
                    value={selectedItem.position.y}
                    onChange={(e) => {
                      const newY = parseInt(e.target.value) || 0;
                      setFloorPlan(prev => ({
                        ...prev,
                        items: prev.items.map(item =>
                          item.id === selectedItem.id
                            ? { ...item, position: { ...item.position, y: Math.max(0, Math.min(GRID_ROWS - item.height, newY)) } }
                            : item
                        )
                      }));
                      setSelectedItem(prev => prev ? { ...prev, position: { ...prev.position, y: Math.max(0, Math.min(GRID_ROWS - prev.height, newY)) } } : null);
                    }}
                    className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  />
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Size: {selectedItem.width} × {selectedItem.height} cells
              </div>
            </div>

            <div>
              <div className="text-sm text-gray-400">Status</div>
              <div className={`inline-block px-2 py-1 rounded text-sm ${
                selectedItem.status === 'available' ? 'bg-green-900/30 text-green-400' :
                selectedItem.status === 'booked' ? 'bg-orange-900/30 text-orange-400' :
                'bg-red-900/30 text-red-400'
              }`}>
                {selectedItem.status.toUpperCase()}
              </div>
            </div>

            {selectedItem.type === 'island' && (
              <>
                <div>
                  <div className="text-sm text-gray-400">Desks</div>
                  <div className="text-base text-white font-bold">{selectedItem.desks}</div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-xs text-gray-400">Features</div>
                  {selectedItem.has_monitors && <div className="text-white text-xs">🖥️ Monitors</div>}
                  {selectedItem.has_docking_stations && <div className="text-white text-xs">🔌 Docking</div>}
                  {selectedItem.has_standing_desks && <div className="text-white text-xs">⬆️ Standing</div>}
                </div>
              </>
            )}

            {selectedItem.type === 'meeting-room' && (
              <>
                <div>
                  <div className="text-xs text-gray-400">Capacity</div>
                  <div className="text-sm text-white font-bold">{selectedItem.capacity} people</div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-xs text-gray-400">Equipment</div>
                  {selectedItem.has_projector && <div className="text-white text-xs">📽️ Projector</div>}
                  {selectedItem.has_video_conference && <div className="text-white text-xs">📹 Video Conf</div>}
                  {selectedItem.has_whiteboard && <div className="text-white text-xs">📝 Whiteboard</div>}
                  {selectedItem.has_phone && <div className="text-white text-xs">📞 Phone</div>}
                </div>
              </>
            )}

            <button
              onClick={() => removeItem(selectedItem.id)}
              className="w-full px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded flex items-center justify-center gap-2 text-sm"
            >
              <Trash2 size={14} />
              Remove
            </button>
          </div>
        ) : (
          <div className="text-center text-gray-400 py-4">
            <Grid3x3 size={32} className="mx-auto mb-1 opacity-50" />
            <p className="text-xs">Click on an item to view properties</p>
          </div>
        )}
        </div>
      </div>

      {/* Add Item Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-[500px] max-h-screen overflow-y-auto">
            <h3 className="text-xl font-bold text-white mb-4">Add to Floor Plan</h3>

            <div className="space-y-4">
              {/* Select Region */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Select Region</label>
                <select
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  onChange={(e) => {
                    const region = e.target.value as Region;
                    if (!region) return;
                    // Store selected region for next step
                    (window as any).selectedRegion = region;
                  }}
                >
                  <option value="">Choose region...</option>
                  {Object.entries(floorPlan.regions)
                    .filter(([_, config]) => config.enabled)
                    .map(([key, config]) => (
                      <option key={key} value={key}>
                        {config.label}
                      </option>
                    ))}
                </select>
              </div>

              {/* Islands */}
              <div>
                <h4 className="text-sm font-bold text-white mb-2">Available Islands</h4>
                <div className="max-h-48 overflow-y-auto space-y-2">
                  {islands.map(island => (
                    <button
                      key={island.id}
                      onClick={() => {
                        const region = (window as any).selectedRegion as Region;
                        if (!region) {
                          alert('Please select a region first');
                          return;
                        }
                        addItemToFloorPlan(island, 'island', region);
                        setShowAddModal(false);
                      }}
                      className="w-full p-3 bg-gray-700 hover:bg-gray-600 rounded text-left"
                    >
                      <div className="text-white font-bold">🏝️ {island.name}</div>
                      <div className="text-sm text-gray-400">{island.total_desks} desks</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Meeting Rooms */}
              <div>
                <h4 className="text-sm font-bold text-white mb-2">Available Meeting Rooms</h4>
                <div className="max-h-48 overflow-y-auto space-y-2">
                  {meetingRooms.map(room => (
                    <button
                      key={room.id}
                      onClick={() => {
                        const region = (window as any).selectedRegion as Region;
                        if (!region) {
                          alert('Please select a region first');
                          return;
                        }
                        addItemToFloorPlan(room, 'meeting-room', region);
                        setShowAddModal(false);
                      }}
                      className="w-full p-3 bg-gray-700 hover:bg-gray-600 rounded text-left"
                    >
                      <div className="text-white font-bold">📹 {room.name}</div>
                      <div className="text-sm text-gray-400">Capacity: {room.capacity}</div>
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setShowAddModal(false)}
                className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
