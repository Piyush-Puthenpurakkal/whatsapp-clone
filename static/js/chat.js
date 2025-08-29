(() => {
  const { me } = window.APP_CONTEXT; // Remove roomName from destructuring
  const showPopup = window.showPopup || ((id, text) => {});
  const hidePopup = window.hidePopup || ((id) => {});

  const chatBox = document.getElementById("chatBox");
  const messageInput = document.getElementById("messageInput");
  const messageForm = document.getElementById("messageForm");
  const sidebarUsers = document.getElementById("sidebarUsers");
  const chatHeaderStatus = document.getElementById("chatHeaderStatus");
  const typingIndicator = document.getElementById("typingIndicator");
  const typingUsernameSpan = document.getElementById("typingUsername");

  let ws = null; // Initialize ws to null
  let connected = false; // Add a flag to track connection status
  const onlineUsers = new Set();
  let typingTimeout = null;
  const TYPING_INDICATOR_TIMEOUT = 3000; // 3 seconds

  // Expose sendWS globally for webrtc.js to use
  window.sendChatWS = function (payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      console.warn("[chat.js] WebSocket not open. Message not sent:", payload);
    }
  };

  function appendMessage(
    sender,
    message,
    timestamp,
    messageId = null,
    readStatus = false,
    messageRoom = null // Added messageRoom parameter
  ) {
    const msgDiv = document.createElement("div");
    msgDiv.classList.add("msg");
    msgDiv.classList.add(sender === me ? "msg--me" : "msg--peer");
    if (messageId) {
      msgDiv.dataset.messageId = messageId;
    }

    const msgAvatar = document.createElement("div");
    msgAvatar.classList.add("msg__avatar");
    msgAvatar.innerText = sender.charAt(0).toUpperCase();
    msgDiv.appendChild(msgAvatar);

    const msgBubble = document.createElement("div");
    msgBubble.classList.add("msg__bubble");

    const msgText = document.createElement("div");
    msgText.classList.add("msg__text");
    msgText.innerText = message;

    const msgTime = document.createElement("div");
    msgTime.classList.add("msg__time");
    const date = new Date(timestamp);
    msgTime.innerText = date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true, // Ensure hh:mm a format
    });

    if (sender === me && messageId) {
      const readReceiptSpan = document.createElement("span");
      readReceiptSpan.classList.add("read-receipt");
      readReceiptSpan.dataset.messageId = messageId;
      // The `readStatus` from backend will be `false` for sent, `true` for delivered/read
      // We'll use CSS to differentiate between delivered and seen (blue)
      readReceiptSpan.dataset.read = readStatus.toString();
      readReceiptSpan.innerHTML = readStatus
        ? '<i class="fas fa-check-double"></i>' // Double tick for delivered/read
        : '<i class="fas fa-check"></i>'; // Single tick for sent
      msgTime.appendChild(readReceiptSpan);
    }

    msgBubble.appendChild(msgText);
    msgBubble.appendChild(msgTime);
    msgDiv.appendChild(msgBubble);
    chatBox.appendChild(msgDiv);

    chatBox.scrollTop = chatBox.scrollHeight; // Auto-scroll to bottom

    // If the message is from the peer, send a read receipt
    // Ensure read receipt is only sent if the message is for the current active room
    if (
      sender !== me &&
      messageId &&
      messageRoom === window.APP_CONTEXT.roomName // Use messageRoom parameter
    ) {
      window.sendChatWS({
        type: "read_receipt",
        message_id: messageId,
        room: window.APP_CONTEXT.roomName,
      });
    }
  }

  // Function to auto-scroll chat box to the bottom
  function scrollToBottom() {
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  // This function will now be called by webrtc.js to set the shared WebSocket
  window.setSharedWebSocket = function (sharedWs) {
    ws = sharedWs;
    connected = true; // Assume connected when shared WS is set
    console.log("[chat.js] Shared WebSocket set and connected.");

    // Request online users list on connect
    window.sendChatWS({
      type: "get_online_users",
      room: window.APP_CONTEXT.roomName,
    });
  };

  // Expose a handler for webrtc.js to pass chat-specific messages to chat.js
  window.handleChatMessage = (data) => {
    console.log("[chat.js] Chat message received:", data); // Debugging
    const t = data.type;
    const from = data.from;
    const to = data.to;
    const messageRoom = data.room; // Get the room from the incoming message
    const recipient = data.recipient; // Get the recipient from the incoming message

    console.log(
      `[chat.js] Current room: ${window.APP_CONTEXT.roomName}, Message room: ${messageRoom}, Sender: ${from}, Recipient: ${recipient}, Me: ${me}`
    ); // Added debug

    // Filter incoming messages strictly by room before rendering
    if (messageRoom && messageRoom !== window.APP_CONTEXT.roomName) {
      console.log(
        `[chat.js] Message for room ${messageRoom} ignored in current room ${window.APP_CONTEXT.roomName}`
      );
      return;
    }

    // Only show messages if the current user is either the sender or recipient
    if (t === "chat" && from !== me && recipient !== me) {
      console.log(
        `[chat.js] Chat message not for current user. Sender: ${from}, Recipient: ${recipient}, Current User: ${me}`
      );
      return;
    }

    switch (t) {
      case "chat":
        // If the message is from the current user, and it's a temporary message, remove it.
        // The server will send back the canonical message.
        if (from === me && data.temp_message_id) {
          const tempMsgDiv = chatBox.querySelector(
            `[data-message-id="${data.temp_message_id}"]`
          );
          if (tempMsgDiv) {
            tempMsgDiv.remove(); // Remove the temporary message
          }
        }

        // Check if the canonical message already exists to prevent duplicates
        if (
          data.message_id &&
          chatBox.querySelector(`[data-message-id="${data.message_id}"]`)
        ) {
          return; // Canonical message already rendered
        }

        // Append the canonical message from the server
        appendMessage(
          from,
          data.message,
          data.timestamp,
          data.message_id,
          data.read,
          messageRoom // Pass messageRoom
        );
        scrollToBottom(); // Scroll to bottom after appending new message
        break;

      case "user_status":
        handleUserStatus(data.username, data.is_online);
        break;

      case "online_users_list":
        updateOnlineUsersList(data.users);
        break;

      case "typing_indicator":
        handleTypingIndicator(data.username, data.is_typing, messageRoom); // Pass messageRoom
        break;

      case "read_receipt":
        // This case handles the read receipt sent by the client to the server.
        // The server will then broadcast 'read_receipt_update' back to the sender.
        // No UI update needed here directly from this client-sent event.
        break;

      case "read_receipt_update": // New event type from consumer
        updateReadReceipt(data.message_id);
        break;

      case "missed_call":
        showPopup("popup-message", "Missed call from " + from);
        setTimeout(() => hidePopup("popup-message"), 4000);
        break;

      case "end_call":
        if (window.GlobalCallManager && window.GlobalCallManager.endCall) {
          window.GlobalCallManager.endCall();
          showPopup("popup-message", `${from} has ended the call.`);
          setTimeout(() => hidePopup("popup-message"), 4000);
        }
        break;

      default:
        // Pass other messages to webrtc.js if it has a handler
        if (window.handleWebRTCMessage) {
          window.handleWebRTCMessage(data);
        }
        break;
    }
  };

  // Handle message form submission
  if (messageForm) {
    messageForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const message = messageInput.value.trim();
      if (message) {
        // Temporarily append message with a client-generated ID to show immediately
        // This will be replaced/updated when the server echoes it back with a canonical ID
        const tempMessageId = `temp-${Date.now()}`;
        appendMessage(
          me,
          message,
          new Date().toISOString(),
          tempMessageId,
          false,
          window.APP_CONTEXT.roomName // Pass current room for temporary message
        );

        window.sendChatWS({
          // Use the exposed sendChatWS
          type: "chat",
          message: message,
          room: window.APP_CONTEXT.roomName, // Use window.APP_CONTEXT.roomName
          recipient: window.APP_CONTEXT.peerUsername, // Include the recipient
          temp_message_id: tempMessageId, // Send temp ID to server
        });
        messageInput.value = "";
        sendTypingStatus(false); // Stop typing after sending message
      }
    });
  }

  // Typing indicator logic
  if (messageInput) {
    messageInput.addEventListener("input", () => {
      sendTypingStatus(true);
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        sendTypingStatus(false);
      }, TYPING_INDICATOR_TIMEOUT);
    });
  }

  function sendTypingStatus(isTyping) {
    window.sendChatWS({
      // Use the exposed sendChatWS
      type: "typing",
      room: window.APP_CONTEXT.roomName, // Use window.APP_CONTEXT.roomName
      is_typing: isTyping,
      recipient: window.APP_CONTEXT.peerUsername, // Add recipient for targeted typing notifications
    });
  }

  function handleTypingIndicator(username, isTyping, messageRoom) {
    // Add messageRoom parameter
    if (messageRoom && messageRoom !== window.APP_CONTEXT.roomName) {
      return; // Ignore typing indicator for other rooms
    }
    if (username !== me) {
      if (isTyping) {
        typingUsernameSpan.innerText = username;
        typingIndicator.style.display = "block";
      } else {
        typingIndicator.style.display = "none";
      }
    }
  }

  function updateReadReceipt(messageId) {
    const readReceiptSpan = chatBox.querySelector(
      `.read-receipt[data-message-id="${messageId}"]`
    );
    if (readReceiptSpan) {
      readReceiptSpan.dataset.read = "true";
      readReceiptSpan.innerHTML = '<i class="fas fa-check-double"></i>';
    }
  }

  function handleUserStatus(username, isOnline) {
    console.log(
      `User status update: ${username} is ${isOnline ? "online" : "offline"}`
    ); // Debugging
    if (isOnline) {
      onlineUsers.add(username);
    } else {
      onlineUsers.delete(username);
    }
    updateSidebarUserStatus(username, isOnline);
    updateChatHeaderStatus();
  }

  function updateOnlineUsersList(users) {
    console.log("Online users list received:", users); // Debugging
    onlineUsers.clear();
    users.forEach((user) => onlineUsers.add(user));
    if (sidebarUsers) {
      Array.from(sidebarUsers.children).forEach((userDiv) => {
        const username = userDiv.dataset.username;
        if (username) {
          updateSidebarUserStatus(username, onlineUsers.has(username));
        }
      });
    }
    updateChatHeaderStatus();
  }

  function updateSidebarUserStatus(username, isOnline) {
    if (sidebarUsers) {
      const userDiv = sidebarUsers.querySelector(
        `[data-username="${username}"]`
      );
      if (userDiv) {
        let statusSpan = userDiv.querySelector(".user-status");
        if (!statusSpan) {
          statusSpan = document.createElement("span");
          statusSpan.classList.add("user-status");
          // Find the chat-item__top div to append the statusSpan
          const chatItemTop = userDiv.querySelector(".chat-item__top");
          if (chatItemTop) {
            chatItemTop.appendChild(statusSpan);
          } else {
            userDiv.appendChild(statusSpan); // Fallback if chat-item__top not found
          }
        }
        statusSpan.textContent = isOnline ? "Online" : "Offline";
        statusSpan.style.color = isOnline
          ? "var(--status-online)"
          : "var(--status-offline)";
        console.log(
          `Sidebar status for ${username}: ${statusSpan.textContent}`
        ); // Debugging
      }
    }
  }

  function updateChatHeaderStatus() {
    if (chatHeaderStatus) {
      const peerUsername = chatHeaderStatus.dataset.peerUsername;
      if (peerUsername) {
        const isOnline = onlineUsers.has(peerUsername);
        chatHeaderStatus.textContent = isOnline ? "Online" : "Offline";
        chatHeaderStatus.style.color = isOnline
          ? "var(--status-online)"
          : "var(--status-offline)";
        console.log(
          `Chat header status for ${peerUsername}: ${chatHeaderStatus.textContent}`
        ); // Debugging
      }
    }
  }

  window.getOnlineUsers = () => onlineUsers;

  // Call connectWS when the DOM is fully loaded
  // document.addEventListener("DOMContentLoaded", () => { // Removed: connectWS will be called explicitly from room.html
  //   if (!connected) {
  //     // Only connect if not already connected
  //     window.connectWS();
  //   }
  // });
})();
