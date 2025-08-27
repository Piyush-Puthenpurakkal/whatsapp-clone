from django.contrib.auth.decorators import login_required
from django.contrib.auth import get_user_model
from django.shortcuts import render, get_object_or_404
from django.http import Http404, JsonResponse
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings # Import settings
from chat.mongo import get_db
import json

User = get_user_model()

def _pair_room_name(a, b):
    a, b = sorted([a, b])
    return f"{a}_{b}"

@login_required
def home(request):
    users = User.objects.exclude(id=request.user.id).order_by("username")
    return render(request, "chat/home.html", {"users": users})

@login_required
def room_with_user(request, username):
    peer = get_object_or_404(User, username=username)
    if peer.id == request.user.id:
        raise Http404("Cannot call yourself.")

    print(f"[DEBUG chat/views.py] Current user: {request.user.username}, Peer: {peer.username}")
    room_name = _pair_room_name(request.user.username, peer.username)
    print(f"[DEBUG chat/views.py] Generated room_name: {room_name}")

    # preload last 50 chat messages from Mongo (if available)
    history = []
    db = get_db()
    if db is not None:
        try:
            print(f"[DEBUG chat/views.py] Querying MongoDB for room: {room_name}")
            cur = db.chats.find({"room": room_name}).sort("timestamp", -1).limit(50)
            for msg in reversed(list(cur)):
                msg['id'] = str(msg['_id']) # Convert ObjectId to string and map to 'id' for template
                # Convert timestamp string back to datetime object for Django template filter
                if 'timestamp' in msg and isinstance(msg['timestamp'], str):
                    from datetime import datetime
                    msg['timestamp'] = datetime.fromisoformat(msg['timestamp'])
                history.append(msg)
            print(f"[DEBUG chat/views.py] Fetched {len(history)} messages from MongoDB for room {room_name}.")
            # print(f"[DEBUG chat/views.py] History: {history}") # Uncomment for full history dump if needed
        except Exception as e:
            print(f"[MongoDB] fetch history failed: {e}")
            print(f"[MongoDB] Error details: {e}")

    users = User.objects.exclude(id=request.user.id).order_by("username")
    return render(
        request,
        "chat/room.html",
        {
            "peer": peer,
            "room_name": room_name,
            "history": history,
            "users": users,
            "webrtc_ice_servers": settings.WEBRTC_ICE_SERVERS, # Pass ICE servers to template
        },
    )

@login_required
def notifications(request):
    logs = []
    db = get_db()
    if db is not None:
        try:
            # Fetch notifications where the current user is the recipient
            cursor = db.notifications.find({"recipient": request.user.username}).sort("timestamp", -1).limit(50)
            logs = list(cursor)
        except Exception as e:
            print(f"[MongoDB] fetch notifications failed: {e}")
    return render(request, "chat/notifications.html", {"logs": logs})

@require_POST
@csrf_exempt
@login_required
def subscribe_push(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            subscription = data['subscription']
            user_id = request.user.id

            db = get_db()
            if db:
                db.subscriptions.update_one(
                    {"user_id": user_id},
                    {"$set": {"subscription": subscription}},
                    upsert=True
                )
                return JsonResponse({"message": "Subscription saved successfully."})
            else:
                return JsonResponse({"error": "MongoDB not connected."}, status=500)
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=400)
    return JsonResponse({"error": "Invalid request method."}, status=405)
