import json
from datetime import datetime
import redis.asyncio as redis
import os
from bson.objectid import ObjectId # Added for MongoDB ObjectId

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.conf import settings
from django.contrib.auth import get_user_model # Added get_user_model
from webpush import send_user_notification # Assuming webpush is installed

from .mongo import get_db
from chat.views import _pair_room_name # Import _pair_room_name
import json
from datetime import datetime
import redis.asyncio as redis
import os
from bson.objectid import ObjectId # Added for MongoDB ObjectId

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.conf import settings
from django.contrib.auth import get_user_model # Added get_user_model
from webpush import send_user_notification # Assuming webpush is installed

from .mongo import get_db
from chat.views import _pair_room_name # Import _pair_room_name

# Initialize Redis client
redis_client = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))

class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_name = self.scope["url_route"]["kwargs"]["room_name"]
        self.room_group_name = f"chat_{self.room_name}"

        user = self.scope.get("user")
        self.username = (
            str(user.username) if getattr(user, "is_authenticated", False) else "Anonymous"
        )
        print(f"[ChatConsumer] User connected: {self.username}, Authenticated: {getattr(user, 'is_authenticated', False)}") # Debugging

        # Add user to a specific group for direct messaging (if needed, otherwise room_group_name is enough)
        self.user_channel_name = f"user_{self.username}"
        await self.channel_layer.group_add(self.user_channel_name, self.channel_name)

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.channel_layer.group_add("global_presence", self.channel_name) # Add to global presence group
        await self.accept()

        # Add user to online users set in Redis and broadcast status
        if self.username != "Anonymous":
            print(f"[ChatConsumer] Adding {self.username} to online_users Redis set.") # Debugging
            await redis_client.sadd("online_users", self.username)
            await self.broadcast_user_status(self.username, True)

            # Send the current list of online users to the newly connected user
            online_users_list = await self.get_online_users()
            print(f"[ChatConsumer] Sending online_users_list to {self.username}: {online_users_list}") # Debugging
            await self.send(text_data=json.dumps({
                "type": "online_users_list",
                "users": online_users_list,
            }))

        try:
            join_msg = {
                "type": "join",
                "from": self.username,
                "event_type": "join",
                "sender": self.username,
            }
            await self.channel_layer.group_send(
                self.room_group_name,
                {"type": "room_event", "message": join_msg},
            )
        except Exception:
            pass

    async def disconnect(self, close_code):
        print(f"[ChatConsumer] User {self.username} disconnected from room {self.room_name} with code {close_code}")

        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
        await self.channel_layer.group_discard(self.user_channel_name, self.channel_name)
        await self.channel_layer.group_discard("global_presence", self.channel_name) # Discard from global presence group

        # Remove user from online users set in Redis and broadcast status
        if self.username != "Anonymous":
            print(f"[ChatConsumer] Removing {self.username} from online_users Redis set.")
            await redis_client.srem("online_users", self.username)
            await self.broadcast_user_status(self.username, False)

        try:
            leave_msg = {
                "type": "leave",
                "from": self.username,
                "event_type": "leave",
                "sender": self.username,
            }
            await self.channel_layer.group_send(
                self.room_group_name,
                {"type": "room_event", "message": leave_msg},
            )
        except Exception:
            pass

    async def broadcast_user_status(self, username, is_online):
        """Broadcasts a user's online/offline status to all relevant groups."""
        status_message = {
            "type": "user_status",
            "username": username,
            "is_online": is_online,
        }
        await self.channel_layer.group_send(
            "global_presence",
            {"type": "send_user_status", "message": status_message},
        )

    async def send_user_status(self, event):
        """Handles the 'send_user_status' event to send status updates to the websocket."""
        message = event["message"]
        await self.send(text_data=json.dumps(message))

    async def get_online_users(self):
        """Returns the list of currently online users from Redis."""
        online_users_bytes = await redis_client.smembers("online_users")
        online_users_list = [user.decode('utf-8') for user in online_users_bytes]
        print(f"[ChatConsumer] Current online users in Redis: {online_users_list}") # Debugging
        return online_users_list

    async def receive(self, text_data=None, bytes_data=None):
        if not text_data:
            return

        try:
            data = json.loads(text_data)
        except Exception:
            return

        msg_type = data.get("type")
        payload = {k: v for k, v in data.items() if k != "type"}
        sender = self.username

        out = {
            "type": msg_type,
            "from": sender,
            "event_type": msg_type,
            "sender": sender,
            **payload,
        }

        db = get_db()
        if db is not None:
            try:
                if msg_type == "chat":
                    recipient_username = payload.get("recipient")
                    # Determine the correct room name for saving based on sender and recipient
                    chat_room_name = _pair_room_name(sender, recipient_username)

                    doc = {
                        "room": chat_room_name, # Use the derived chat_room_name for saving
                        "sender": sender,
                        "message": payload.get("message", ""),
                        "timestamp": datetime.utcnow().isoformat(), # Convert to ISO 8601 string
                        "read": False, # For read receipts
                    }
                    print(f"[DEBUG chat/consumers.py] Attempting to save message to MongoDB for room: {chat_room_name}")
                    print(f"[DEBUG chat/consumers.py] Message doc: {doc}")
                    result = await sync_to_async(db.chats.insert_one)(doc)
                    out["message_id"] = str(result.inserted_id) # Add the message ID
                    out["timestamp"] = doc["timestamp"] # Add timestamp to the broadcast message
                    out["read"] = doc["read"] # Add read status to the broadcast message
                    out["temp_message_id"] = payload.get("temp_message_id") # Pass temp ID back to client
                    print(f"[DEBUG chat/consumers.py] Message saved with ID: {out['message_id']}")

                    # Send push notification for new chat message
                    if sender != self.room_name: # Only send if not a self-message in a 1-1 chat
                        await self.send_push_notification(
                            recipient_username=self.room_name, # Assuming room_name is the peer's username in 1-1 chat
                            title=f"New message from {sender}",
                            body=payload.get("message", ""),
                            url=f"/chat/room/{sender}/" # Link to the chat room
                        )

                elif msg_type in (
                    "offer", "answer", "ice",
                    "call", "missed_call",
                    "end_call", "reject"
                ):
                    recipient = payload.get("to_user")
                    doc = {
                        "room": self.room_name,
                        "sender": sender,
                        "recipient": recipient,
                        "type": msg_type,
                        "payload": payload,
                        "timestamp": datetime.utcnow(),
                        "read": False,
                    }
                    await sync_to_async(db.notifications.insert_one)(doc)
                    # Send push notification for call events
                    if recipient:
                        notification_body = ""
                        notification_url = "/"
                        if msg_type == "call":
                            notification_body = f"Incoming call from {sender}"
                            notification_url = f"/chat/room/{sender}/" # Link to the call room
                        elif msg_type == "missed_call":
                            notification_body = f"Missed call from {sender}"
                            notification_url = f"/chat/room/{sender}/"
                        
                        if notification_body:
                            await self.send_push_notification(
                                recipient_username=recipient,
                                title="VideoChat Call",
                                body=notification_body,
                                url=notification_url
                            )

                elif msg_type == "typing":
                    # Broadcast typing indicator to the room, excluding the sender
                    await self.channel_layer.group_send(
                        self.room_group_name,
                        {
                            "type": "typing_indicator",
                            "username": sender,
                            "is_typing": payload.get("is_typing"),
                        }
                    )
                    return # Don't save typing indicators to DB

                elif msg_type == "read_receipt":
                    message_id = payload.get("message_id")
                    if message_id:
                        await sync_to_async(db.chats.update_one)(
                            {"_id": ObjectId(message_id)},
                            {"$set": {"read": True, "read_at": datetime.utcnow()}}
                        )
                        # Broadcast the read receipt update to the sender's channel
                        await self.channel_layer.group_send(
                            self.user_channel_name,
                            {"type": "room_event", "message": {"type": "read_receipt_update", "message_id": message_id}},
                        )
                    return # Don't broadcast read receipts globally, handle client-side

            except Exception as e:
                print(f"[MongoDB] save failed: {e}")

        # Determine if the message should be sent to a specific user or broadcast
        to_user = data.get("to")
        if msg_type == "get_online_users":
            online_users_list = await self.get_online_users()
            await self.send(text_data=json.dumps({
                "type": "online_users_list",
                "users": online_users_list,
            }))
        elif msg_type == "chat":
            recipient_username = payload.get("recipient")
            
            # Send to sender's channel for immediate display and confirmation
            await self.channel_layer.group_send(
                self.user_channel_name,
                {"type": "room_event", "message": out},
            )
            
            # Send to recipient's channel if specified and not the sender
            if recipient_username and recipient_username != self.username:
                await self.channel_layer.group_send(
                    f"user_{recipient_username}",
                    {"type": "room_event", "message": out},
                )
            # Also send to the room group for general chat if it's a group chat,
            # or if we want all participants in a 1-1 chat to receive it via room_group_name
            # (though direct user_channel_name is more precise for 1-1)
            # For now, let's assume 1-1 chat and direct sending is sufficient.
            # If group chats are intended, this logic might need adjustment.
        elif to_user:
            # Send directly to the target user's channel for other message types
            await self.channel_layer.group_send(
                f"user_{to_user}",
                {"type": "room_event", "message": out},
            )
        else:
            # Broadcast to the entire room group for other message types (e.g., group calls)
            await self.channel_layer.group_send(
                self.room_group_name,
                {"type": "room_event", "message": out},
            )

    async def send_push_notification(self, recipient_username, title, body, url):
        db = get_db()
        if db is not None:
            try:
                # Get the recipient user object
                RecipientUser = await database_sync_to_async(get_user_model().objects.get)(username=recipient_username)

                # Find the recipient's subscription from MongoDB
                subscription_doc = await sync_to_async(db.subscriptions.find_one)(
                    {"user_id": RecipientUser.id} # Use recipient's user_id
                )
                if subscription_doc and subscription_doc.get("subscription"):
                    subscription_info = subscription_doc["subscription"]
                    payload = {"head": title, "body": body, "url": url}
                    await sync_to_async(send_user_notification)(
                        user=RecipientUser, # Pass the Django recipient user object
                        payload=payload,
                        vapid_private_key=settings.VAPID_PRIVATE_KEY,
                        vapid_admin_email=settings.VAPID_ADMIN_EMAIL,
                        push_subscription=subscription_info
                    )
            except Exception as e:
                print(f"[WebPush] Failed to send push notification: {e}")

    async def typing_indicator(self, event):
        """Handles the 'typing_indicator' event to send typing status to the websocket."""
        username = event["username"]
        is_typing = event["is_typing"]
        if username != self.username: # Don't send typing indicator back to the sender
            await self.send(text_data=json.dumps({
                "type": "typing_indicator",
                "username": username,
                "is_typing": is_typing,
            }))

    async def room_event(self, event):
        message = event.get("message", {})
        try:
            await self.send(text_data=json.dumps(message))
        except Exception:
            pass
