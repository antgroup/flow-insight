import json
import os
import time
from typing import Dict, List, Optional

import dill

from flow_insight.storage.snapshot.base import SnapshotStorageBackend


class MemoryStorageBackend(SnapshotStorageBackend):
    def __init__(self, storage_dir: str = None):
        self._data = {}
        self._snapshots = {}
        self._snapshot_metadata = {}  # Store metadata about snapshots (timestamp, flow_id)
        self.storage_dir = storage_dir or "/tmp/flow_insight_snapshots"

        # Create storage directory if it doesn't exist
        os.makedirs(self.storage_dir, exist_ok=True)
        os.makedirs(os.path.join(self.storage_dir, "snapshots"), exist_ok=True)
        os.makedirs(os.path.join(self.storage_dir, "metadata"), exist_ok=True)

        # Load existing snapshots from disk
        self._load_snapshots_from_disk()

    def _load_snapshots_from_disk(self):
        """Load existing snapshots and metadata from disk on initialization"""
        metadata_dir = os.path.join(self.storage_dir, "metadata")

        # Load metadata files
        for filename in os.listdir(metadata_dir):
            if filename.endswith(".json"):
                label = filename[:-5]  # Remove .json extension
                metadata_path = os.path.join(metadata_dir, filename)
                try:
                    with open(metadata_path, "r") as f:
                        self._snapshot_metadata[label] = json.load(f)
                except Exception as e:
                    print(f"Failed to load metadata for snapshot {label}: {e}")

    def _save_snapshot_to_disk(self, label: str, data: dict):
        """Save snapshot data to disk"""
        snapshot_path = os.path.join(self.storage_dir, "snapshots", f"{label}.pkl")
        try:
            with open(snapshot_path, "wb") as f:
                dill.dump(data, f)
        except Exception as e:
            print(f"Failed to save snapshot {label} to disk: {e}")
            raise

    def _load_snapshot_from_disk(self, label: str) -> Optional[dict]:
        """Load snapshot data from disk"""
        snapshot_path = os.path.join(self.storage_dir, "snapshots", f"{label}.pkl")
        if not os.path.exists(snapshot_path):
            return None

        try:
            with open(snapshot_path, "rb") as f:
                return dill.load(f)
        except Exception as e:
            print(f"Failed to load snapshot {label} from disk: {e}")
            return None

    def _save_metadata_to_disk(self, label: str, metadata: dict):
        """Save snapshot metadata to disk"""
        metadata_path = os.path.join(self.storage_dir, "metadata", f"{label}.json")
        try:
            with open(metadata_path, "w") as f:
                json.dump(metadata, f, indent=2)
        except Exception as e:
            print(f"Failed to save metadata for snapshot {label}: {e}")
            raise

    def __setitem__(self, key, value):
        self._data[key] = value

    def __getitem__(self, key):
        return self._data[key]

    def __delitem__(self, key):
        del self._data[key]

    def take_snapshot(self):
        snapshot = MemoryStorageBackend(self.storage_dir)
        snapshot._data = dill.loads(dill.dumps(self._data))
        return snapshot

    def store_snapshot(self, label: str, flow_id: str = None):
        """Store a snapshot with metadata to disk"""
        timestamp = int(time.time() * 1000)

        # Save snapshot data to disk
        self._save_snapshot_to_disk(label, self._data)

        # Save metadata
        metadata = {"timestamp": timestamp, "flow_id": flow_id, "label": label}
        self._snapshot_metadata[label] = metadata
        self._save_metadata_to_disk(label, metadata)

    def restore_snapshots(self):
        ret = {}
        for label in self._snapshot_metadata.keys():
            data = self._load_snapshot_from_disk(label)
            if data is not None:
                snapshot = MemoryStorageBackend(self.storage_dir)
                snapshot._data = dill.loads(dill.dumps(data))
                ret[label] = snapshot
        return ret

    def list_snapshots(self, flow_id: str = None) -> List[Dict]:
        """List all snapshots with their metadata, optionally filtered by flow_id"""
        snapshots = []
        for label, metadata in self._snapshot_metadata.items():
            if flow_id is None or metadata.get("flow_id") == flow_id:
                snapshots.append(
                    {
                        "label": label,
                        "timestamp": metadata["timestamp"],
                        "flow_id": metadata.get("flow_id"),
                        "created_at": metadata["timestamp"],
                    }
                )

        # Sort by timestamp in descending order (newest first)
        return sorted(snapshots, key=lambda x: x["timestamp"], reverse=True)

    def get_snapshot(self, label: str) -> Optional["MemoryStorageBackend"]:
        """Get a specific snapshot by label from disk"""
        if label not in self._snapshot_metadata:
            return None

        data = self._load_snapshot_from_disk(label)
        if data is None:
            return None

        snapshot = MemoryStorageBackend(self.storage_dir)
        snapshot._data = dill.loads(dill.dumps(data))
        return snapshot

    def get_snapshot_count(self, flow_id: str = None) -> int:
        """Get the number of snapshots, optionally filtered by flow_id"""
        if flow_id is None:
            return len(self._snapshots)

        count = 0
        for metadata in self._snapshot_metadata.values():
            if metadata.get("flow_id") == flow_id:
                count += 1
        return count

    def delete_snapshot(self, label: str):
        """Delete a snapshot and its metadata from both memory and disk"""
        # Remove from memory
        if label in self._snapshot_metadata:
            del self._snapshot_metadata[label]

        # Remove files from disk
        snapshot_path = os.path.join(self.storage_dir, "snapshots", f"{label}.pkl")
        metadata_path = os.path.join(self.storage_dir, "metadata", f"{label}.json")

        try:
            if os.path.exists(snapshot_path):
                os.remove(snapshot_path)
        except Exception as e:
            print(f"Failed to delete snapshot file {label}: {e}")

        try:
            if os.path.exists(metadata_path):
                os.remove(metadata_path)
        except Exception as e:
            print(f"Failed to delete metadata file {label}: {e}")
