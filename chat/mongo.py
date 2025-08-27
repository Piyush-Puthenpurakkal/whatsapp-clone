import os
from pymongo import MongoClient
from django.conf import settings

_client = None
_db = None

def _init():
    global _client, _db
    uri = getattr(settings, "MONGO_URI", "") or os.getenv("MONGO_URI", "")
    dbname = getattr(settings, "MONGO_DB_NAME", "") or os.getenv("MONGO_DB_NAME", "")
    if uri and dbname:
        try:
            _client = MongoClient(uri, serverSelectionTimeoutMS=3000)
            _client.server_info()
            _db = _client[dbname]

            # Create indexes for chats collection
            _db.chats.create_index([("room", 1), ("timestamp", 1)])
            # Create indexes for notifications collection
            _db.notifications.create_index([("room", 1), ("timestamp", 1)])
            _db.notifications.create_index([("recipient", 1), ("timestamp", 1)]) # For user-specific notifications

        except Exception as e:
            print(f"[MongoDB] connection failed: {e}")
            _client = None
            _db = None

def get_db():
    global _db
    if _db is None:
        _init()
    return _db
