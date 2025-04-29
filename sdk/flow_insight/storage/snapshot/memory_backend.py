from flow_insight.storage.snapshot.base import SnapshotStorageBackend

class MemoryStorageBackend(SnapshotStorageBackend):
    def __init__(self):
        self._data = {}

    def __setitem__(self, key, value):
        self._data[key] = value

    def __getitem__(self, key):
        return self._data[key]

    def __delitem__(self, key):
        del self._data[key]
