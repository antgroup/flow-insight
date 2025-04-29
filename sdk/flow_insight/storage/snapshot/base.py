from enum import Enum


class StorageType(Enum):
    MEMORY = "memory"


class SnapshotStorageBackend:
    def __init__(self):
        pass

    def __setitem__(self, key, value):
        pass

    def __getitem__(self, key):
        pass

    def __delitem__(self, key):
        pass

    def __contains__(self, key):
        pass
