import httpx
from pydantic import BaseModel

from flow_insight.storage.persist.base import StorageClient
from flow_insight.storage.persist.model import RecordType


class HTTPStorageClient(StorageClient):
    def __init__(self, server_url: str):
        super().__init__()
        self._async_client = httpx.AsyncClient()
        self._sync_client = httpx.Client()
        self._server_url = server_url

    async def _async_request_server(self, endpoint: str, data: dict = None, method: str = "POST"):
        url = f"{self._server_url}/{endpoint}"
        if method == "POST":
            response = await self._async_client.post(url, json=data)
        elif method == "GET":
            response = await self._async_client.get(url, params=data)
        else:
            raise ValueError(f"Unsupported HTTP method: {method}")

        response.raise_for_status()
        return response.json() if response.content else None

    def _sync_request_server(self, endpoint: str, data: dict = None, method: str = "POST"):
        url = f"{self._server_url}/{endpoint}"
        if method == "POST":
            response = self._sync_client.post(url, json=data)
        elif method == "GET":
            response = self._sync_client.get(url, params=data)
        else:
            raise ValueError(f"Unsupported HTTP method: {method}")

        response.raise_for_status()
        return response.json() if response.content else None

    async def async_emit_record(self, record_type: RecordType, record: BaseModel):
        data = {"record_type": record_type.value, "record": record.model_dump()}
        return await self._async_request_server(endpoint="emit", data=data, method="POST")

    def sync_emit_record(self, record_type: RecordType, record: BaseModel):
        data = {"record_type": record_type.value, "record": record.model_dump()}
        return self._sync_request_server(endpoint="emit", data=data, method="POST")

    async def aclose(self):
        await self._async_client.aclose()

    def close(self):
        self._sync_client.close()
