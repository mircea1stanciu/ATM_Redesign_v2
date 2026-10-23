"""Android emulator / iOS simulator management for the Test Run section."""
import enum

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_current_user
from app.services import device_service
from app.services.device_service import DeviceError

router = APIRouter()


class DevicePlatform(str, enum.Enum):
    android = "android"
    ios = "ios"


def _require_operator(user) -> None:
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role.lower() == "viewer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Viewers cannot start or stop devices")


@router.get("")
async def list_devices(_user=Depends(get_current_user)):
    return await device_service.list_devices()


@router.post("/{platform}/{device_id}/boot")
async def boot_device(platform: DevicePlatform, device_id: str, user=Depends(get_current_user)):
    _require_operator(user)
    try:
        return await device_service.boot_device(platform.value, device_id)
    except DeviceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post("/{platform}/{device_id}/shutdown")
async def shutdown_device(platform: DevicePlatform, device_id: str, user=Depends(get_current_user)):
    _require_operator(user)
    try:
        return await device_service.shutdown_device(platform.value, device_id)
    except DeviceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
