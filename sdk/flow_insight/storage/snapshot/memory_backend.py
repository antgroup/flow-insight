import dill

from flow_insight.storage.snapshot.base import SnapshotStorageBackend


class MemoryStorageBackend(SnapshotStorageBackend):
    def __init__(self, session_id: str):
        self._session_id = session_id
        self._data = {}
        self._snapshots = {}

    def __setitem__(self, key, value):
        self._data[key] = value

    def __getitem__(self, key):
        return self._data[key]

    def __delitem__(self, key):
        del self._data[key]

    def take_snapshot(self):
        snapshot = MemoryStorageBackend(self._session_id)
        snapshot._data = dill.loads(dill.dumps(self._data))
        return snapshot

    def store_snapshot(self, label: str):
        self._snapshots[label] = dill.loads(dill.dumps(self._data))

    def restore_snapshots(self):
        ret = {}
        for label, data in self._snapshots.items():
            snapshot = MemoryStorageBackend(self._session_id)
            snapshot._data = dill.loads(dill.dumps(data))
            ret[label] = snapshot
        return ret

