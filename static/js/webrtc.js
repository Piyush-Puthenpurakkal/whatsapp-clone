(() => {
  "use strict";
  console.log("[WebRTC] webrtc.js loaded.");

  const { me, roomName } = window.APP_CONTEXT; // Destructure 'me' and 'roomName' globally
  console.log("[WebRTC] APP_CONTEXT defined:", window.APP_CONTEXT);

  const chatWindow = document.getElementById("chatBox");
  const messageForm = document.getElementById("messageForm");
  const messageInput = document.getElementById("messageInput");
  const btnStartCall = document.getElementById("btnStartCall");
  const btnStartGroupCall = document.getElementById("btnStartGroupCall"); // New group call button
  const callWindow = document.getElementById("callWindow");
  const callTitle = document.getElementById("callTitle");
  const remoteVideo = document.getElementById("remoteVideo");
  const groupVideoContainer = document.getElementById("groupVideoContainer"); // New container for group videos
  const localVideo = document.getElementById("localVideo");
  const btnToggleMic = document.getElementById("btnToggleMic");
  const btnToggleCamera = document.getElementById("btnToggleCamera");
  const incomingCallBox = document.getElementById("incomingCallBox");
  const incomingCallText = document.getElementById("incomingCallText");
  const loadingIndicator = document.getElementById("loadingIndicator"); // Loading indicator
  const loadingText = document.getElementById("loadingText"); // Loading text

  const GlobalCallManager = window.GlobalCallManager;

  let ws; // Declare ws once here
  let localStream;
  let peerConnections = {}; // Use an object for multiple peer connections in group calls
  let isMuted = false;
  let isCameraOff = false;
  // let ringtone = new Audio("/static/audio/ringtone.mp3"); // Commented out to prevent 404

  function log(msg) {
    console.log("[WebRTC]", msg);
  }

  function showLoading(text) {
    if (loadingIndicator && loadingText) {
      loadingText.innerText = text;
      loadingIndicator.style.display = "flex";
    }
  }

  function hideLoading() {
    if (loadingIndicator) {
      loadingIndicator.style.display = "none";
    }
  }

  // Expose a handler for chat.js to pass messages to webrtc.js
  window.handleWebRTCMessage = async (data) => {
    const t = data.type;
    const from = data.from;
    const to = data.to;

    if (to && to !== me) return;

    switch (t) {
      case "offer":
        if (from === me) break;
        // ringtone.play(); // Commented out ringtone
        GlobalCallManager.handleIncomingCall({
          from: from,
          offer: data.offer,
          room: roomName,
          is_group_call: data.is_group_call || false, // Pass group call status
        });
        incomingCallText.innerText = `${from} is calling…`;
        incomingCallBox.style.display = "block";
        break;

      case "user_status":
        // This is handled by chat.js, but we might need to react to it for call management
        const peerUsername = roomName.split("_").find((user) => user !== me);
        if (
          data.username === peerUsername &&
          !data.is_online &&
          GlobalCallManager.currentCall &&
          GlobalCallManager.currentCall.type === "active"
        ) {
          GlobalCallManager.endCall();
          window.showPopup(
            "popup-message",
            `${data.username} went offline. Call ended.`
          );
          setTimeout(() => window.hidePopup("popup-message"), 4000);
        }
        break;

      case "answer":
        if (from === me) break;
        const pcAnswer = data.is_group_call
          ? peerConnections[from]
          : GlobalCallManager.currentPeerConnection;
        if (pcAnswer) {
          await pcAnswer.setRemoteDescription(
            new RTCSessionDescription(data.answer)
          );
        }
        break;

      case "ice":
        if (from === me) break;
        const pcIce = data.is_group_call
          ? peerConnections[from]
          : GlobalCallManager.currentPeerConnection;
        if (pcIce) {
          try {
            await pcIce.addIceCandidate(data.candidate);
          } catch (e) {
            console.error("Error adding ICE candidate:", e);
          }
        }
        break;

      case "end_call":
        GlobalCallManager.endCall();
        break;

      case "reject":
        GlobalCallManager.endCall();
        break;
    }
  };

  window.connectWebRTCWS = async function () {
    // Expose globally
    const roomName = window.APP_CONTEXT.roomName;
    if (!roomName || roomName === "undefined") {
      console.error(
        "[webrtc.js] Invalid roomName for WebRTC WebSocket connection:",
        roomName
      );
      return;
    }

    const token = localStorage.getItem("accessToken");
    let wsUrl =
      (location.protocol === "https:" ? "wss://" : "ws://") +
      location.host +
      "/ws/chat/" +
      roomName +
      "/";
    if (token) {
      wsUrl += `?token=${token}`;
    }
    console.log("[webrtc.js] Retrieved Token from localStorage:", token);
    console.log("[webrtc.js] WebRTC WebSocket URL:", wsUrl);
    ws = new WebSocket(wsUrl);
    GlobalCallManager.currentWebSocket = ws;

    ws.onopen = async () => {
      log("WebRTC WS open");
      sendWS({ type: "join" });
      await GlobalCallManager.restoreCallState();
      if (window.setSharedWebSocket) {
        window.setSharedWebSocket(ws);
      } else {
        console.warn(
          "[webrtc.js] window.setSharedWebSocket is not defined. Chat functionality might be limited."
        );
      }
    };

    ws.onmessage = async (evt) => {
      const data = JSON.parse(evt.data);
      console.log("[webrtc.js] WS message received:", data);
      if (
        data.type === "chat" ||
        data.type === "user_status" ||
        data.type === "online_users_list" ||
        data.type === "typing_indicator" ||
        data.type === "read_receipt"
      ) {
        if (window.handleChatMessage) {
          window.handleChatMessage(data);
        } else {
          console.warn(
            "[webrtc.js] window.handleChatMessage is not defined. Chat messages not handled."
          );
        }
      } else {
        window.handleWebRTCMessage(data);
      }
    };

    ws.onclose = () => {
      log("WebRTC WS closed. Reconnecting in 1.5 seconds...");
      setTimeout(window.connectWebRTCWS, 1500); // Use window.connectWebRTCWS for global access
    };

    ws.onerror = (err) => {
      console.error("WebRTC WebSocket error:", err);
      ws.close();
    };
  }; // End of window.connectWebRTCWS function

  function sendWS(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      console.warn(
        "[webrtc.js] WebSocket not open. Message not sent:",
        payload
      );
    }
  }

  async function startCall(
    peerUsername,
    existingOffer = null,
    isGroupCall = false
  ) {
    showLoading("Starting call...");
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localVideo.srcObject = localStream;
      GlobalCallManager.setLocalStream(localStream);

      const pc = new RTCPeerConnection({
        iceServers: window.APP_CONTEXT.iceServers,
      });
      peerConnections[peerUsername] = pc;
      GlobalCallManager.currentPeerConnection = pc;

      localStream
        .getTracks()
        .forEach((track) => pc.addTrack(track, localStream));

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendWS({
            type: "ice",
            to: peerUsername,
            candidate: e.candidate,
            is_group_call: isGroupCall,
          });
        }
      };

      pc.ontrack = (e) => {
        if (isGroupCall) {
          const videoElement = document.createElement("video");
          videoElement.autoplay = true;
          videoElement.playsInline = true;
          videoElement.srcObject = e.streams[0];
          videoElement.dataset.peer = peerUsername;
          groupVideoContainer.appendChild(videoElement);
        } else {
          remoteVideo.srcObject = e.streams[0];
          GlobalCallManager.setRemoteStream(e.streams[0]);
        }
      };

      if (existingOffer) {
        await pc.setRemoteDescription(new RTCSessionDescription(existingOffer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendWS({
          type: "answer",
          to: peerUsername,
          answer,
          is_group_call: isGroupCall,
        });
      } else {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await pc.setLocalDescription(offer);
        sendWS({
          type: "offer",
          to: peerUsername,
          offer,
          room: roomName,
          is_group_call: isGroupCall,
        });
      }

      GlobalCallManager.currentCall = {
        type: "active",
        peer: peerUsername,
        room: roomName,
        isGroup: isGroupCall,
      };
      GlobalCallManager.saveCallState(GlobalCallManager.currentCall);
      GlobalCallManager.showCallWindow();
      updateCallUI();
      hideLoading();
    } catch (error) {
      console.error("Error starting call:", error);
      alert(
        "Failed to start call. Please check camera/microphone permissions."
      );
      GlobalCallManager.endCall();
      hideLoading();
    }
  }

  async function restoreCallState() {
    const savedCallState = GlobalCallManager.getCallState();
    if (
      savedCallState &&
      savedCallState.room === roomName &&
      savedCallState.type === "active"
    ) {
      log("Restoring call state...");
      const peerUsername = savedCallState.peer;
      await startCall(peerUsername, null, savedCallState.isGroup);
    }
  }

  function updateCallUI() {
    const currentCall = GlobalCallManager.currentCall;
    if (currentCall && currentCall.isGroup) {
      callTitle.innerText = `Group Call in ${currentCall.room}`;
      remoteVideo.style.display = "none";
      groupVideoContainer.style.display = "flex";
    } else {
      const peerUsername = roomName.split("_").find((user) => user !== me);
      callTitle.innerText = `Video Call with @${peerUsername}`;
      remoteVideo.style.display = "block";
      groupVideoContainer.style.display = "none";
    }

    if (btnToggleMic) {
      btnToggleMic.classList.toggle("active", !isMuted);
      btnToggleMic.querySelector("i").className = isMuted
        ? "fas fa-microphone-slash"
        : "fas fa-microphone";
    }

    if (btnToggleCamera) {
      btnToggleCamera.classList.toggle("active", !isCameraOff);
      btnToggleCamera.querySelector("i").className = isCameraOff
        ? "fas fa-video-slash"
        : "fas fa-video";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    // Event listener for starting a call
    if (btnStartCall) {
      btnStartCall.addEventListener("click", async () => {
        console.log("[WebRTC] btnStartCall clicked!");
        const peerUsername = roomName.split("_").find((user) => user !== me);
        if (!peerUsername) {
          console.error(
            "Cannot start call: No peer username found in roomName."
          );
          return;
        }
        console.log("[WebRTC] Peer username:", peerUsername);

        if (
          window.getOnlineUsers &&
          !window.getOnlineUsers().has(peerUsername)
        ) {
          window.showPopup(
            "popup-message",
            `${peerUsername} is currently offline.`
          );
          setTimeout(() => window.hidePopup("popup-message"), 4000);
          return;
        }

        await startCall(peerUsername);
      });
    }

    // Event listener for starting a group call
    if (btnStartGroupCall) {
      btnStartGroupCall.addEventListener("click", async () => {
        console.log("[WebRTC] btnStartGroupCall clicked!");
        const onlinePeers = Array.from(window.getOnlineUsers()).filter(
          (user) => user !== me
        );

        if (onlinePeers.length === 0) {
          window.showPopup(
            "popup-message",
            "No other users online for a group call."
          );
          setTimeout(() => window.hidePopup("popup-message"), 4000);
          return;
        }

        showLoading("Starting group call...");
        for (const peer of onlinePeers) {
          await startCall(peer, null, true);
        }
        hideLoading();
      });
    }

    // Mute/Unmute Mic
    if (btnToggleMic) {
      btnToggleMic.addEventListener("click", () => {
        if (localStream) {
          localStream.getAudioTracks().forEach((track) => {
            track.enabled = !track.enabled;
            isMuted = !track.enabled;
          });
          updateCallUI();
        }
      });
    }

    // Toggle Camera
    if (btnToggleCamera) {
      btnToggleCamera.addEventListener("click", () => {
        if (localStream) {
          localStream.getVideoTracks().forEach((track) => {
            track.enabled = !track.enabled;
            isCameraOff = !track.enabled;
          });
          updateCallUI();
        }
      });
    }

    // Listen for global call acceptance from GlobalCallManager (when navigating to a room)
    window.addEventListener("globalCallAccepted", async (event) => {
      const incomingCallData = event.detail;
      if (!incomingCallData) return;

      // ringtone.pause(); // Commented out ringtone
      // ringtone.currentTime = 0; // Commented out ringtone

      const peerUsername = incomingCallData.from;
      await startCall(
        peerUsername,
        incomingCallData.offer,
        incomingCallData.isGroup
      );
      GlobalCallManager.hideGlobalCallPopup();
      incomingCallBox.style.display = "none";
    });

    // Listen for global call rejection from GlobalCallManager
    window.addEventListener("globalCallRejected", () => {
      // ringtone.pause(); // Commented out ringtone
      // ringtone.currentTime = 0; // Commented out ringtone
      incomingCallBox.style.display = "none";
    });

    // Initialize GlobalCallManager here, after APP_CONTEXT is defined
    window.GlobalCallManager.init();
  });
})();
