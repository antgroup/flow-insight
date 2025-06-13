import asyncio
from typing import Any

import httpx

from flow_insight.storage.snapshot.model import RecordType


class StorageClient:
    """Base class for storage clients"""

    async def async_ping(self):
        raise NotImplementedError

    def sync_ping(self):
        raise NotImplementedError

    async def async_emit_record(self, record_type: RecordType, data: Any):
        raise NotImplementedError

    def sync_emit_record(self, record_type: RecordType, data: Any):
        raise NotImplementedError

    async def aclose(self):
        raise NotImplementedError

    def close(self):
        raise NotImplementedError


class HTTPStorageClient(StorageClient):
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self._client = None

    def _get_client(self):
        if self._client is None:
            self._client = httpx.AsyncClient()
        return self._client

    async def async_ping(self):
        client = self._get_client()
        try:
            response = await client.get(f"{self.base_url}/ping")
            return response.json()
        except Exception as e:
            return {"result": False, "msg": str(e)}

    def sync_ping(self):
        with httpx.Client() as client:
            try:
                response = client.get(f"{self.base_url}/ping")
                return response.json()
            except Exception as e:
                return {"result": False, "msg": str(e)}

    async def async_emit_record(self, record_type: RecordType, data: Any):
        client = self._get_client()
        try:
            payload = {
                "record_type": record_type.value,
                "record": data.model_dump() if hasattr(data, "model_dump") else data,
            }
            response = await client.post(f"{self.base_url}/emit", json=payload)
            return response.json()
        except Exception as e:
            return {"result": False, "msg": str(e)}

    def sync_emit_record(self, record_type: RecordType, data: Any):
        with httpx.Client() as client:
            try:
                payload = {
                    "record_type": record_type.value,
                    "record": data.model_dump() if hasattr(data, "model_dump") else data,
                }
                response = client.post(f"{self.base_url}/emit", json=payload)
                return response.json()
            except Exception as e:
                return {"result": False, "msg": str(e)}

    async def aclose(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    def close(self):
        if self._client:
            asyncio.create_task(self._client.aclose())
            self._client = None
