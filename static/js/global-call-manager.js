// Global Call Manager - Handles video calls across chat switches
(() => {
  "use strict";

  // Global call state
  window.GlobalCallManager = {
    currentCall: null,
    incomingCall: null,
    localStream: null,
    remoteStream: null,
    isInitialized: false,
    currentPeerConnection: null, // For single call compatibility
    peerConnections: {}, // Store multiple peer connections for group calls
    currentWebSocket: null,
    isMinimized: true,
    isMicOn: true,
    isCamOn: true,

    // UI elements
    callWindow: null,
    localVideo: null,
    remoteVideo: null,
    btnMinimizeMaximize: null,
    btnEndCall: null,
    btnToggleMic: null,
    btnToggleCamera: null,
    btnHangUp: null, // New hang up button
    callTitle: null,

    // Initialize the global call manager
    init() {
      if (this.isInitialized) return;
      this.isInitialized = true;

      // Get UI references
      this.callWindow = document.getElementById("callWindow");
      this.localVideo = document.getElementById("localVideo");
      this.remoteVideo = document.getElementById("remoteVideo");
      this.btnMinimizeMaximize = document.getElementById("btnMinimizeMaximize");
      this.btnEndCall = document.getElementById("btnEndCall"); // This is the 'X' button
      this.btnToggleMic = document.getElementById("btnToggleMic");
      this.btnToggleCamera = document.getElementById("btnToggleCamera");
      this.btnHangUp = document.getElementById("btnHangUp"); // Reference the new hang up button
      this.callTitle = document.getElementById("callTitle");

      // Add event listeners
      if (this.btnMinimizeMaximize) {
        this.btnMinimizeMaximize.addEventListener("click", () =>
          this.toggleMinimizeMaximize()
        );
      }
      if (this.btnEndCall) {
        this.btnEndCall.addEventListener("click", () => this.endCall());
      }
      if (this.btnToggleMic) {
        this.btnToggleMic.addEventListener("click", () => this.toggleMic());
      }
      if (this.btnToggleCamera) {
        this.btnToggleCamera.addEventListener("click", () =>
          this.toggleCamera()
        );
      }
      if (this.btnHangUp) {
        this.btnHangUp.addEventListener("click", () => this.endCall());
      }

      // Make call window draggable
      this.makeDraggable(
        this.callWindow,
        this.callWindow.querySelector(".call-header")
      );

      // Listen for storage changes to sync across tabs/pages
      window.addEventListener("storage", (e) => {
        if (e.key === "activeCall") {
          this.handleCallStateChange(e.newValue);
        }
      });

      // Check for existing call state on page load
      this.restoreCallState();

      // Set up periodic cleanup of expired calls
      setInterval(() => this.cleanupExpiredCalls(), 5000);
    },

    // Set local video stream
    setLocalStream(stream) {
      this.localStream = stream;
      if (this.localVideo) {
        this.localVideo.srcObject = stream;
      }
      this.updateControlButtons();
    },

    // Set remote video stream
    setRemoteStream(stream) {
      this.remoteStream = stream;
      if (this.remoteVideo) {
        this.remoteVideo.srcObject = stream;
      }
    },

    // Show the call window
    showCallWindow() {
      if (this.callWindow) {
        this.callWindow.style.display = "block";
        // When showing, default to maximized for better initial experience
        this.callWindow.classList.remove("minimized");
        this.callWindow.classList.add("maximized");
        this.isMinimized = false; // Set to false as it's maximized
        this.updateMinimizeMaximizeIcon();
        this.updateControlButtons();
        this.updateLocalVideoVisibility(); // Ensure local video visibility is correct
      }
    },

    // Hide the call window
    hideCallWindow() {
      if (this.callWindow) {
        this.callWindow.style.display = "none";
        this.callWindow.classList.remove("minimized", "maximized");
      }
    },

    // Toggle minimize/maximize
    toggleMinimizeMaximize() {
      if (this.callWindow) {
        this.isMinimized = !this.isMinimized;
        this.callWindow.classList.toggle("minimized", this.isMinimized);
        this.callWindow.classList.toggle("maximized", !this.isMinimized);
        this.updateMinimizeMaximizeIcon();
        this.updateLocalVideoVisibility();
      }
    },

    // Update minimize/maximize icon
    updateMinimizeMaximizeIcon() {
      if (this.btnMinimizeMaximize) {
        const icon = this.btnMinimizeMaximize.querySelector("i");
        if (icon) {
          icon.classList.toggle("fa-expand-alt", this.isMinimized);
          icon.classList.toggle("fa-compress-alt", !this.isMinimized);
        }
      }
    },

    // Toggle microphone
    toggleMic() {
      if (this.localStream) {
        this.isMicOn = !this.isMicOn;
        this.localStream.getAudioTracks().forEach((track) => {
          track.enabled = this.isMicOn;
        });
        this.updateControlButtons();
      }
    },

    // Toggle camera
    toggleCamera() {
      if (this.localStream) {
        this.isCamOn = !this.isCamOn;
        this.localStream.getVideoTracks().forEach((track) => {
          track.enabled = this.isCamOn;
        });
        this.updateControlButtons();
        this.updateLocalVideoVisibility();
      }
    },

    // Update control button states
    updateControlButtons() {
      if (this.btnToggleMic) {
        this.btnToggleMic.classList.toggle("active", this.isMicOn);
        this.btnToggleMic.querySelector("i").className = this.isMicOn
          ? "fas fa-microphone"
          : "fas fa-microphone-slash";
      }
      if (this.btnToggleCamera) {
        this.btnToggleCamera.classList.toggle("active", this.isCamOn);
        this.btnToggleCamera.querySelector("i").className = this.isCamOn
          ? "fas fa-video"
          : "fas fa-video-slash";
      }
    },

    // Update local video visibility based on camera state and maximized mode
    updateLocalVideoVisibility() {
      if (this.localVideo) {
        const isMaximized = this.callWindow.classList.contains("maximized");
        if (isMaximized && !this.isCamOn) {
          this.localVideo.classList.add("hidden");
        } else {
          this.localVideo.classList.remove("hidden");
        }
      }
    },

    // Make an element draggable
    makeDraggable(element, handle) {
      let pos1 = 0,
        pos2 = 0,
        pos3 = 0,
        pos4 = 0;
      if (handle) {
        handle.onmousedown = dragMouseDown;
      } else {
        element.onmousedown = dragMouseDown;
      }

      function dragMouseDown(e) {
        e = e || window.event;
        e.preventDefault();
        // get the mouse cursor position at startup:
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        // call a function whenever the cursor moves:
        document.onmousemove = elementDrag;
      }

      function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        // calculate the new cursor position:
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        // set the element's new position:
        element.style.top = element.offsetTop - pos2 + "px";
        element.style.left = element.offsetLeft - pos1 + "px";
      }

      function closeDragElement() {
        // stop moving when mouse button is released:
        document.onmouseup = null;
        document.onmousemove = null;
      }
    },

    // Save call state to localStorage
    saveCallState(callData) {
      const state = {
        ...callData,
        timestamp: Date.now(),
        currentPage: window.location.pathname,
      };
      localStorage.setItem("activeCall", JSON.stringify(state));
    },

    // Get call state from localStorage
    getCallState() {
      const stored = localStorage.getItem("activeCall");
      if (!stored) return null;

      try {
        const state = JSON.parse(stored);
        // Expire calls older than 2 minutes
        if (Date.now() - state.timestamp > 120000) {
          this.clearCallState();
          return null;
        }
        return state;
      } catch (e) {
        this.clearCallState();
        return null;
      }
    },

    // Clear call state
    clearCallState() {
      localStorage.removeItem("activeCall");
      this.currentCall = null;
      this.incomingCall = null;
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => track.stop());
        this.localStream = null;
      }
      this.remoteStream = null;
      if (this.localVideo) this.localVideo.srcObject = null;
      if (this.remoteVideo) this.remoteVideo.srcObject = null;
      this.hideCallWindow();

      // Clear all peer connections for group calls
      for (const peer in this.peerConnections) {
        if (this.peerConnections[peer]) {
          this.peerConnections[peer].close();
        }
      }
      this.peerConnections = {};
      this.currentPeerConnection = null; // Reset for single call compatibility
    },

    // Handle incoming call
    handleIncomingCall(callData) {
      this.incomingCall = callData;
      this.saveCallState({
        type: "incoming",
        from: callData.from,
        offer: callData.offer,
        room: callData.room || this.getCurrentRoom(),
        isGroup: callData.is_group_call || false, // Store if it's a group call
      });

      // Show global call popup
      this.showGlobalCallPopup(callData.from);
    },

    // Handle call acceptance
    async acceptCall() {
      if (!this.incomingCall) return;

      try {
        // Get user media
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        this.setLocalStream(stream);

        // Update call state
        this.currentCall = {
          type: "active",
          peer: this.incomingCall.from,
          room: this.incomingCall.room,
          isGroup: this.incomingCall.isGroup, // Preserve group call status
        };

        this.saveCallState(this.currentCall);
        this.hideGlobalCallPopup();
        this.showCallWindow(); // Show the floating window

        // Navigate to the correct room if not already there
        const expectedRoom = this.incomingCall.room;
        if (this.getCurrentRoom() !== expectedRoom) {
          const peerUsername = this.incomingCall.from;
          window.location.href = `/room/${peerUsername}/`;
          return;
        }

        // Trigger acceptance in the current room
        this.triggerRoomCallAcceptance();
      } catch (error) {
        console.error("Error accepting call:", error);
        this.rejectCall();
      }
    },

    // Handle call rejection
    rejectCall() {
      if (this.incomingCall) {
        // Send rejection through current WebSocket if available
        if (this.currentWebSocket) {
          this.currentWebSocket.send(
            JSON.stringify({
              type: "reject",
              to: this.incomingCall.from,
            })
          );
        }
      }

      this.clearCallState();
      this.hideGlobalCallPopup();
    },

    // Handle call end
    endCall() {
      if (this.currentCall) {
        // Send end call through current WebSocket if available
        if (this.currentWebSocket) {
          this.currentWebSocket.send(
            JSON.stringify({
              type: "end_call",
              to: this.currentCall.peer,
              is_group_call: this.currentCall.isGroup,
            })
          );
        }
      }

      // Stop local stream
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => track.stop());
        this.localStream = null;
      }

      // Close all peer connections (for group calls)
      for (const peer in this.peerConnections) {
        if (this.peerConnections[peer]) {
          this.peerConnections[peer].close();
        }
      }
      this.peerConnections = {};
      this.currentPeerConnection = null; // Reset for single call compatibility

      this.clearCallState();
      this.hideCallWindow();
    },

    // Show global call popup (for incoming calls)
    showGlobalCallPopup(callerName) {
      const popup = document.getElementById("popup-call");
      const popupText = document.getElementById("popup-call-text");
      if (popup && popupText) {
        popupText.innerText = `${callerName} is calling you...`;
        popup.style.display = "block";
      }
    },

    // Hide global call popup
    hideGlobalCallPopup() {
      const popup = document.getElementById("popup-call");
      if (popup) {
        popup.style.display = "none";
      }
    },

    // Restore call state on page load
    restoreCallState() {
      const state = this.getCallState();
      if (!state) return;

      if (state.type === "incoming") {
        this.incomingCall = state;
        this.showGlobalCallPopup(state.from);
      } else if (state.type === "active") {
        this.currentCall = state;
        this.showCallWindow(); // Show the floating window and maximize it
        // The room-specific code will handle active call restoration of streams
      }
    },

    // Handle call state changes from other tabs/pages
    handleCallStateChange(newStateJson) {
      if (!newStateJson) {
        this.hideGlobalCallPopup();
        this.clearCallState(); // Clear all state if no active call
        return;
      }

      try {
        const newState = JSON.parse(newStateJson);
        if (newState.type === "incoming") {
          this.incomingCall = newState;
          this.showGlobalCallPopup(newState.from);
        } else if (newState.type === "active") {
          this.currentCall = newState;
          this.hideGlobalCallPopup();
          this.showCallWindow();
          // Dispatch an event to the room-specific webrtc.js to handle stream restoration
          const event = new CustomEvent("globalCallStateRestored", {
            detail: newState,
          });
          window.dispatchEvent(event);
        } else {
          this.hideGlobalCallPopup();
          this.clearCallState();
        }
      } catch (e) {
        console.error("Error parsing call state:", e);
        this.clearCallState();
      }
    },

    // Get current room name from APP_CONTEXT
    getCurrentRoom() {
      return window.APP_CONTEXT.roomName || null;
    },

    // Get room name for a specific user
    getRoomNameForUser(username) {
      // This should match the Django view's _pair_room_name logic
      const currentUser = document.querySelector("strong")?.textContent || "";
      if (!currentUser || !username) return null;

      const users = [currentUser, username].sort();
      return `${users[0]}_${users[1]}`;
    },

    // Trigger call acceptance in the current room
    triggerRoomCallAcceptance() {
      // This will be called by room-specific code
      const event = new CustomEvent("globalCallAccepted", {
        detail: this.incomingCall,
      });
      window.dispatchEvent(event);
    },

    // Clean up expired calls
    cleanupExpiredCalls() {
      const state = this.getCallState();
      if (!state) return;

      // Remove calls older than 2 minutes
      if (Date.now() - state.timestamp > 120000) {
        this.endCall(); // Use endCall to ensure all resources are properly released
        this.hideGlobalCallPopup();
      }
    },
  };

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      window.GlobalCallManager.init();
    });
  } else {
    window.GlobalCallManager.init();
  }
})();
