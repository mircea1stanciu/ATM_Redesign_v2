"""Live delivery: the open notification WebSockets of each user (one per browser tab)."""
import asyncio
import logging
from typing import Optional

from fastapi import WebSocket

logger = logging.getLogger("atm.notifications")


class NotificationHub:
    def __init__(self) -> None:
        self.sockets: dict[int, set[WebSocket]] = {}
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self._tasks: set[asyncio.Task] = set()

    def connect(self, user_id: int, websocket: WebSocket) -> None:
        self.loop = asyncio.get_running_loop()
        self.sockets.setdefault(user_id, set()).add(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        sockets = self.sockets.get(user_id)
        if sockets is not None:
            sockets.discard(websocket)
            if not sockets:
                self.sockets.pop(user_id, None)

    async def _send(self, user_id: int, payload: dict) -> None:
        for websocket in list(self.sockets.get(user_id, ())):
            try:
                await websocket.send_json(payload)
            except Exception:  # a closed tab: forget it
                self.disconnect(user_id, websocket)

    def publish(self, user_id: int, payload: dict) -> None:
        """Send to the user's open tabs. Safe to call from the event loop and from worker threads."""
        loop = self.loop
        if loop is None or loop.is_closed() or user_id not in self.sockets:
            return
        try:
            running: Optional[asyncio.AbstractEventLoop] = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            task = loop.create_task(self._send(user_id, payload))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
        else:
            asyncio.run_coroutine_threadsafe(self._send(user_id, payload), loop)


hub = NotificationHub()
