from fastapi import APIRouter, Depends
from auth import get_current_admin
from models import AdminUser
from schemas import NetworkConfig
import occtl as oc

router = APIRouter(prefix="/network", tags=["network"])


@router.get("", response_model=NetworkConfig)
async def get_network(_: AdminUser = Depends(get_current_admin)):
    return await oc.get_network_settings()


@router.put("", response_model=NetworkConfig)
async def update_network(
    body: NetworkConfig,
    _: AdminUser = Depends(get_current_admin),
):
    await oc.set_network_settings(body.model_dump())
    return await oc.get_network_settings()
