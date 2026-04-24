/**
 * WebRTC Live Commerce Platform
 * WebRTC Connection & Signaling Manager
 */

class WebRTCManager {
  constructor() {
    this.peerConnections = new Map();    // peerId -> RTCPeerConnection
    this.localStream = null;
    this.peerId = this._generateId();
    this.ws = null;
    this.wsUrl = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.role = null;          // 'host' | 'viewer'
    this.sessionId = null;
    this.hostId = null;
    this.onMessageCallbacks = {};
    this.statsInterval = null;

    // ICE configuration with STUN servers
    this.iceConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ],
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };

    console.log(`[WebRTC] Peer ID: ${this.peerId}`);
  }

  // ── ID Generation ────────────────────────────────────────────────────────

  _generateId() {
    return Math.random().toString(36).substring(2, 10);
  }

  // ── WebSocket Connection ─────────────────────────────────────────────────

  connect(serverUrl = null) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = location.host;
    this.wsUrl = serverUrl || `${proto}//${host}/ws/${this.peerId}`;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          console.log('[WS] Connected');
          this.reconnectAttempts = 0;
          this._startPing();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this._handleSignalingMessage(data);
          } catch (e) {
            console.error('[WS] Parse error:', e);
          }
        };

        this.ws.onclose = (event) => {
          console.warn('[WS] Disconnected:', event.code, event.reason);
          this._stopPing();
          this._triggerCallback('ws_disconnected', { code: event.code });
          this._scheduleReconnect();
        };

        this.ws.onerror = (err) => {
          console.error('[WS] Error:', err);
          reject(err);
        };

      } catch (e) {
        reject(e);
      }
    });
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this._triggerCallback('connection_failed', {});
      return;
    }
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => this.connect(), delay);
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('[WS] Cannot send — not connected');
    }
  }

  _startPing() {
    this._pingInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, 25000);
  }

  _stopPing() {
    clearInterval(this._pingInterval);
  }

  // ── Signaling Message Handler ────────────────────────────────────────────

  async _handleSignalingMessage(msg) {
    const { type } = msg;
    console.log('[Signal] Received:', type, msg.from || '');

    switch (type) {
      case 'session_created':
        this.sessionId = msg.session_id;
        this._triggerCallback('session_created', msg);
        break;

      case 'session_joined':
        this.sessionId = msg.session_id;
        this.hostId = msg.host_id;
        this._triggerCallback('session_joined', msg);
        // Viewer initiates WebRTC offer to host
        await this._createOfferToHost(msg.host_id);
        break;

      case 'viewer_joined':
        this._triggerCallback('viewer_joined', msg);
        break;

      case 'offer':
        await this._handleOffer(msg.from, msg.sdp);
        break;

      case 'answer':
        await this._handleAnswer(msg.from, msg.sdp);
        break;

      case 'ice_candidate':
        await this._handleIceCandidate(msg.from, msg.candidate);
        break;

      case 'viewer_count':
        this._triggerCallback('viewer_count', msg);
        break;

      case 'chat_message':
        this._triggerCallback('chat_message', msg);
        break;

      case 'purchase_notification':
        this._triggerCallback('purchase_notification', msg);
        break;

      case 'purchase_alert':
        this._triggerCallback('purchase_alert', msg);
        break;

      case 'peer_disconnected':
        this._handlePeerDisconnect(msg.peer_id);
        this._triggerCallback('peer_disconnected', msg);
        break;

      case 'error':
        this._triggerCallback('error', msg);
        break;

      case 'pong':
        break;

      default:
        console.log('[Signal] Unknown message type:', type);
    }
  }

  // ── Media Access ─────────────────────────────────────────────────────────

  async getLocalStream(constraints = null) {
    const defaultConstraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    };

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(
        constraints || defaultConstraints
      );
      console.log('[Media] Got local stream:', this.localStream.getTracks().map(t => t.kind));
      return this.localStream;
    } catch (err) {
      console.error('[Media] getUserMedia error:', err);
      throw err;
    }
  }

  // ── RTCPeerConnection Setup ──────────────────────────────────────────────

  _createPeerConnection(peerId) {
    const pc = new RTCPeerConnection(this.iceConfig);
    this.peerConnections.set(peerId, pc);

    // Add local tracks if host
    if (this.localStream && this.role === 'host') {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // ICE candidate handler
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send({
          type: 'ice_candidate',
          target: peerId,
          candidate: event.candidate
        });
      }
    };

    // Connection state monitoring
    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state (${peerId}):`, pc.connectionState);
      this._triggerCallback('connection_state', {
        peerId,
        state: pc.connectionState
      });
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE state (${peerId}):`, pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        pc.restartIce();
      }
    };

    // Remote stream (viewer side)
    pc.ontrack = (event) => {
      console.log('[WebRTC] Got remote track:', event.track.kind);
      this._triggerCallback('remote_track', {
        peerId,
        stream: event.streams[0] || null,
        track: event.track
      });
    };

    return pc;
  }

  // ── Offer / Answer Flow ───────────────────────────────────────────────────

  async _createOfferToHost(hostId) {
    console.log('[WebRTC] Creating offer to host:', hostId);
    const pc = this._createPeerConnection(hostId);

    try {
      const offer = await pc.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: true
      });
      await pc.setLocalDescription(offer);

      this.send({
        type: 'offer',
        target: hostId,
        sdp: pc.localDescription
      });
    } catch (err) {
      console.error('[WebRTC] Error creating offer:', err);
    }
  }

  async _handleOffer(fromId, sdp) {
    console.log('[WebRTC] Handling offer from viewer:', fromId);
    const pc = this._createPeerConnection(fromId);

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.send({
        type: 'answer',
        target: fromId,
        sdp: pc.localDescription
      });
    } catch (err) {
      console.error('[WebRTC] Error handling offer:', err);
    }
  }

  async _handleAnswer(fromId, sdp) {
    console.log('[WebRTC] Handling answer from host:', fromId);
    const pc = this.peerConnections.get(fromId);
    if (pc) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      } catch (err) {
        console.error('[WebRTC] Error handling answer:', err);
      }
    }
  }

  async _handleIceCandidate(fromId, candidate) {
    const pc = this.peerConnections.get(fromId);
    if (pc && candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('[WebRTC] Error adding ICE candidate:', err);
      }
    }
  }

  _handlePeerDisconnect(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }
  }

  // ── Session Actions ──────────────────────────────────────────────────────

  createSession(opts) {
    this.role = 'host';
    this.send({
      type: 'create_session',
      title: opts.title,
      product_name: opts.productName,
      product_price: parseFloat(opts.productPrice),
      product_description: opts.productDescription,
      product_image: opts.productImage
    });
  }

  joinSession(sessionId, username) {
    this.role = 'viewer';
    this.send({
      type: 'join_session',
      session_id: sessionId.toUpperCase(),
      username
    });
  }

  sendChat(text, username) {
    this.send({ type: 'chat_message', text, username });
  }

  sendPurchaseIntent(username) {
    this.send({ type: 'purchase_intent', username });
  }

  // ── Media Controls ───────────────────────────────────────────────────────

  toggleAudio() {
    if (this.localStream) {
      const track = this.localStream.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        return track.enabled;
      }
    }
    return null;
  }

  toggleVideo() {
    if (this.localStream) {
      const track = this.localStream.getVideoTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        return track.enabled;
      }
    }
    return null;
  }

  // ── Stats Collection ──────────────────────────────────────────────────────

  async getConnectionStats(peerId = null) {
    const targetId = peerId || this.peerConnections.keys().next().value;
    if (!targetId) return null;
    const pc = this.peerConnections.get(targetId);
    if (!pc) return null;

    const stats = await pc.getStats();
    const result = {
      video: {},
      audio: {},
      connection: { rtt: null, packetLoss: null, bandwidth: null }
    };

    stats.forEach(report => {
      if (report.type === 'inbound-rtp' && report.kind === 'video') {
        result.video = {
          packetsReceived: report.packetsReceived,
          framesDecoded: report.framesDecoded,
          frameWidth: report.frameWidth,
          frameHeight: report.frameHeight,
          framesPerSecond: report.framesPerSecond
        };
      }
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        result.connection.rtt = report.currentRoundTripTime
          ? Math.round(report.currentRoundTripTime * 1000)
          : null;
      }
    });

    return result;
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  disconnect() {
    this._stopPing();
    clearInterval(this.statsInterval);

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();

    if (this.ws) {
      this.ws.close(1000, 'User disconnected');
      this.ws = null;
    }
  }

  // ── Callback System ──────────────────────────────────────────────────────

  on(event, callback) {
    this.onMessageCallbacks[event] = callback;
    return this;
  }

  _triggerCallback(event, data) {
    const cb = this.onMessageCallbacks[event];
    if (cb) cb(data);
  }
}

// Export globally
window.WebRTCManager = WebRTCManager;
