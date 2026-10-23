import logging

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manage WebSocket connections for real-time test streaming."""
    
    def __init__(self):
        # Dictionary of run_id -> set of active connections
        self.active_connections: dict[str, set[WebSocket]] = {}
    
    async def connect(self, run_id: str, websocket: WebSocket):
        """
        Connect a WebSocket client to a test run stream.
        
        Args:
            run_id: ID of test run
            websocket: WebSocket connection
        """
        await websocket.accept()
        
        if run_id not in self.active_connections:
            self.active_connections[run_id] = set()
        
        self.active_connections[run_id].add(websocket)
        logger.info(f"Client connected to run {run_id}. Total connections: {len(self.active_connections[run_id])}")
    
    async def disconnect(self, run_id: str, websocket: WebSocket):
        """
        Disconnect a WebSocket client.
        
        Args:
            run_id: ID of test run
            websocket: WebSocket connection
        """
        if run_id in self.active_connections:
            self.active_connections[run_id].discard(websocket)
            
            # Clean up empty connection sets
            if not self.active_connections[run_id]:
                del self.active_connections[run_id]
            
            logger.info(f"Client disconnected from run {run_id}")
    
    async def broadcast_log(self, run_id: str, log_type: str, message: str):
        """
        Broadcast a log message to all clients watching a test run.
        
        Args:
            run_id: ID of test run
            log_type: Type of log (stdout, stderr, status, error)
            message: Log message content
        """
        if run_id not in self.active_connections:
            return
        
        payload = {
            "type": log_type,
            "data": message,
        }
        
        # Send to all connected clients
        disconnected = []
        for websocket in self.active_connections[run_id]:
            try:
                await websocket.send_json(payload)
            except Exception as e:
                logger.warning(f"Failed to send message to client: {e}")
                disconnected.append(websocket)
        
        # Clean up disconnected clients
        for websocket in disconnected:
            await self.disconnect(run_id, websocket)
    
    async def broadcast_status(self, run_id: str, status: str, data: dict = None):
        """
        Broadcast a status update to all clients.
        
        Args:
            run_id: ID of test run
            status: Status value (running, passed, failed, error)
            data: Additional status data
        """
        payload = {
            "type": "status",
            "status": status,
            "data": data or {},
        }
        
        await self.broadcast_to_json(run_id, payload)
    
    async def broadcast_to_json(self, run_id: str, payload: dict):
        """Broadcast JSON payload to all clients."""
        if run_id not in self.active_connections:
            return
        
        disconnected = []
        for websocket in self.active_connections[run_id]:
            try:
                await websocket.send_json(payload)
            except Exception as e:
                logger.warning(f"Failed to send message to client: {e}")
                disconnected.append(websocket)
        
        for websocket in disconnected:
            await self.disconnect(run_id, websocket)
    
    def get_active_connections_count(self, run_id: str) -> int:
        """Get number of active connections for a run."""
        return len(self.active_connections.get(run_id, set()))


# Global connection manager instance
connection_manager = ConnectionManager()
