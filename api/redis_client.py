"""Shared async Redis client (initialised in main.py lifespan)."""
from redis.asyncio import Redis

_redis: Redis | None = None


async def init_redis(url: str) -> None:
    global _redis
    _redis = Redis.from_url(url, decode_responses=True)


async def get_redis() -> Redis | None:
    return _redis


async def close_redis() -> None:
    global _redis
    if _redis:
        await _redis.aclose()
        _redis = None
