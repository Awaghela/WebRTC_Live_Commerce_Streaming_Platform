/**
 * WebRTC Live Commerce Platform
 * Main Application Logic
 */

(async () => {
  const rtc = new WebRTCManager();
  let streamStartTime = null;
  let timerInterval = null;
  let purchaseCount = 0;
  let messageCount = 0;
  let viewerUsername = 'Viewer';
  let hostUsername = 'Host';

  // ── Screen Navigation ──────────────────────────────────────────────────

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(id);
    if (screen) screen.classList.add('active');
  }

  function notify(msg, type = 'info') {
    const el = document.getElementById('notification');
    el.textContent = msg;
    el.className = `notification ${type}`;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 3000);
  }

  function showToast(text) {
    const toast = document.getElementById('purchase-toast');
    toast.querySelector('.toast-text').textContent = text;
    toast.style.display = 'flex';
    setTimeout(() => toast.style.display = 'none', 4000);
  }

  // ── Home Screen ──────────────────────────────────────────────────────────

  document.getElementById('btn-go-host').onclick = () => showScreen('screen-host-setup');
  document.getElementById('btn-go-viewer').onclick = () => showScreen('screen-viewer-join');
  document.getElementById('btn-back-from-host').onclick = () => showScreen('screen-home');
  document.getElementById('btn-back-from-viewer').onclick = () => showScreen('screen-home');

  document.getElementById('btn-refresh-sessions').onclick = loadSessions;

  async function loadSessions() {
    try {
      const resp = await fetch('/api/sessions');
      const data = await resp.json();
      const list = document.getElementById('sessions-list');

      if (!data.sessions || data.sessions.length === 0) {
        list.innerHTML = '<div class="empty-state">No live streams right now. Be the first!</div>';
        return;
      }

      list.innerHTML = data.sessions.map(s => `
        <div class="session-item" data-id="${s.id}">
          <div class="session-live-dot"></div>
          <div class="session-info">
            <div class="session-title">${escapeHtml(s.title)}</div>
            <div class="session-meta">${escapeHtml(s.product.name)} · $${s.product.price.toFixed(2)}</div>
          </div>
          <div class="session-viewers">👁 ${s.viewer_count}</div>
        </div>
      `).join('');

      list.querySelectorAll('.session-item').forEach(item => {
        item.onclick = () => {
          document.getElementById('session-id-input').value = item.dataset.id;
          showScreen('screen-viewer-join');
        };
      });
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  }

  loadSessions();

  // ── WebSocket Setup ──────────────────────────────────────────────────────

  try {
    await rtc.connect();
  } catch (e) {
    console.error('WebSocket connection failed:', e);
    notify('Could not connect to server. Is the backend running?', 'error');
  }

  // ── WebRTC Event Handlers ────────────────────────────────────────────────

  rtc
    .on('session_created', (msg) => {
      document.getElementById('host-session-id').textContent = msg.session_id;
      startStreamTimer();
      notify(`Stream live! Session ID: ${msg.session_id}`, 'success');
      showScreen('screen-host-live');
    })

    .on('session_joined', (msg) => {
      document.getElementById('viewer-stream-title').textContent = msg.title;
      const p = msg.product;
      document.getElementById('viewer-product-name').textContent = p.name;
      document.getElementById('viewer-product-price').textContent = `$${p.price.toFixed(2)}`;
      document.getElementById('viewer-product-desc').textContent = p.description;
      document.getElementById('btn-buy-price').textContent = `$${p.price.toFixed(2)}`;
      if (p.image) document.getElementById('viewer-product-img').src = p.image;
      addSystemMessage('viewer-chat-messages', 'Connected to stream 🎉');
      showScreen('screen-viewer-live');
    })

    .on('viewer_joined', (msg) => {
      document.getElementById('host-viewer-count').textContent = msg.viewer_count;
      document.getElementById('stat-peak').textContent = Math.max(
        parseInt(document.getElementById('stat-peak').textContent || 0),
        msg.viewer_count
      );
      addSystemMessage('host-chat-messages', `👀 A viewer joined (${msg.viewer_count} watching)`);
    })

    .on('viewer_count', (msg) => {
      const vcEl = document.getElementById('host-viewer-count');
      const vcEl2 = document.getElementById('viewer-count-display');
      if (vcEl) vcEl.textContent = msg.count;
      if (vcEl2) vcEl2.textContent = msg.count;
      const peakEl = document.getElementById('stat-peak');
      if (peakEl) peakEl.textContent = Math.max(parseInt(peakEl.textContent || 0), msg.peak || msg.count);
    })

    .on('remote_track', ({ stream, track }) => {
      const video = document.getElementById('remote-video');
      if (stream && video) {
        video.srcObject = stream;
        video.play().catch(e => console.warn('Autoplay failed:', e));
        // Hide connection overlay
        const connStatus = document.getElementById('conn-status');
        if (connStatus) connStatus.classList.add('hidden');
        notify('Stream connected!', 'success');
      }
    })

    .on('connection_state', ({ peerId, state }) => {
      console.log('Connection state:', peerId, state);
      if (state === 'connected') {
        const connStatus = document.getElementById('conn-status');
        if (connStatus) connStatus.classList.add('hidden');
      } else if (state === 'failed' || state === 'disconnected') {
        const connStatus = document.getElementById('conn-status');
        if (connStatus) {
          connStatus.classList.remove('hidden');
          connStatus.innerHTML = `<div class="spinner"></div>Reconnecting...`;
        }
      }
    })

    .on('chat_message', (msg) => {
      const chatEl1 = document.getElementById('host-chat-messages');
      const chatEl2 = document.getElementById('viewer-chat-messages');
      const html = buildChatMsg(msg);
      if (chatEl1) appendMessage(chatEl1, html);
      if (chatEl2) appendMessage(chatEl2, html);
      messageCount++;
      const statMsg = document.getElementById('stat-messages');
      if (statMsg) statMsg.textContent = messageCount;
    })

    .on('purchase_notification', (msg) => {
      purchaseCount++;
      const pcEl = document.getElementById('purchase-count');
      if (pcEl) pcEl.textContent = purchaseCount;
      const statP = document.getElementById('stat-purchases');
      if (statP) statP.textContent = purchaseCount;
      addSystemMessage('host-chat-messages',
        `🛍️ ${msg.username} wants to buy ${msg.product.name}!`
      );
      showToast(`${msg.username} is buying ${msg.product.name}!`);
    })

    .on('purchase_alert', (msg) => {
      const html = `<div class="purchase-msg"><span class="icon">🛍️</span><span class="ptext">${escapeHtml(msg.username)} just bought ${escapeHtml(msg.product)}!</span></div>`;
      const chatEl = document.getElementById('viewer-chat-messages');
      if (chatEl) appendMessage(chatEl, html);
      const hostChat = document.getElementById('host-chat-messages');
      if (hostChat) appendMessage(hostChat, html);
      showToast(`${msg.username} just bought ${msg.product}! 🎉`);
    })

    .on('peer_disconnected', (msg) => {
      if (msg.role === 'host') {
        addSystemMessage('viewer-chat-messages', '⚠️ Host ended the stream');
        notify('The host ended the stream', 'error');
        setTimeout(() => showScreen('screen-home'), 3000);
      }
    })

    .on('error', (msg) => {
      notify(msg.message || 'An error occurred', 'error');
      const joinErr = document.getElementById('join-error');
      if (joinErr) {
        joinErr.textContent = msg.message;
        joinErr.style.display = 'block';
      }
    });

  // ── Host: Go Live ────────────────────────────────────────────────────────

  document.getElementById('btn-preview-camera').onclick = async () => {
    const title = document.getElementById('stream-title').value.trim();
    const username = document.getElementById('host-username').value.trim();
    const productName = document.getElementById('product-name').value.trim();
    const productPrice = document.getElementById('product-price').value;
    const productDescription = document.getElementById('product-description').value.trim();
    const productImage = document.getElementById('product-image').value.trim();

    if (!title || !productName || !productPrice) {
      notify('Please fill in stream title, product name, and price.', 'error');
      return;
    }

    hostUsername = username || 'Host';

    try {
      const stream = await rtc.getLocalStream();
      const video = document.getElementById('local-video');
      video.srcObject = stream;
      video.play();

      // Update product card
      document.getElementById('host-product-name').textContent = productName;
      document.getElementById('host-product-price').textContent = `$${parseFloat(productPrice).toFixed(2)}`;
      document.getElementById('host-product-desc').textContent = productDescription;
      if (productImage) document.getElementById('host-product-img').src = productImage;

      // Create session
      rtc.createSession({
        title,
        productName,
        productPrice,
        productDescription,
        productImage
      });

    } catch (err) {
      if (err.name === 'NotAllowedError') {
        notify('Camera/microphone permission denied. Please allow access.', 'error');
      } else {
        notify(`Media error: ${err.message}`, 'error');
      }
    }
  };

  // ── Host Controls ────────────────────────────────────────────────────────

  let audioEnabled = true, videoEnabled = true;

  document.getElementById('btn-toggle-audio').onclick = function () {
    audioEnabled = rtc.toggleAudio();
    this.classList.toggle('active', !audioEnabled);
    this.title = audioEnabled ? 'Mute Audio' : 'Unmute Audio';
  };

  document.getElementById('btn-toggle-video').onclick = function () {
    videoEnabled = rtc.toggleVideo();
    this.classList.toggle('active', !videoEnabled);
    this.title = videoEnabled ? 'Hide Video' : 'Show Video';
  };

  document.getElementById('btn-end-stream').onclick = () => {
    if (confirm('End the stream? All viewers will be disconnected.')) {
      stopStreamTimer();
      rtc.disconnect();
      showScreen('screen-home');
      notify('Stream ended', 'info');
      loadSessions();
    }
  };

  document.getElementById('btn-copy-session').onclick = () => {
    const sid = document.getElementById('host-session-id').textContent;
    navigator.clipboard.writeText(sid).then(() => notify('Session ID copied!', 'success'));
  };

  // ── Viewer: Join ─────────────────────────────────────────────────────────

  document.getElementById('btn-join-stream').onclick = () => {
    const sid = document.getElementById('session-id-input').value.trim().toUpperCase();
    const uname = document.getElementById('viewer-username').value.trim();

    if (!sid) {
      document.getElementById('join-error').textContent = 'Please enter a session ID.';
      document.getElementById('join-error').style.display = 'block';
      return;
    }

    viewerUsername = uname || `Viewer-${rtc.peerId.slice(0,4)}`;
    document.getElementById('join-error').style.display = 'none';
    rtc.joinSession(sid, viewerUsername);
  };

  document.getElementById('session-id-input').addEventListener('input', function () {
    this.value = this.value.toUpperCase();
  });

  document.getElementById('btn-viewer-volume').onclick = function () {
    const video = document.getElementById('remote-video');
    video.muted = !video.muted;
    this.classList.toggle('active', video.muted);
  };

  document.getElementById('btn-leave-stream').onclick = () => {
    rtc.disconnect();
    showScreen('screen-home');
    loadSessions();
  };

  // ── Buy Button ───────────────────────────────────────────────────────────

  document.getElementById('btn-buy-now').onclick = function () {
    this.disabled = true;
    this.textContent = '✓ Purchase Sent!';
    rtc.sendPurchaseIntent(viewerUsername);
    setTimeout(() => {
      this.disabled = false;
      const price = document.getElementById('viewer-product-price').textContent;
      this.innerHTML = `<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> Buy Now — ${price}`;
    }, 3000);
  };

  // ── Chat: Host ───────────────────────────────────────────────────────────

  document.getElementById('btn-host-send-chat').onclick = () => sendHostChat();
  document.getElementById('host-chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendHostChat();
  });

  function sendHostChat() {
    const input = document.getElementById('host-chat-input');
    const text = input.value.trim();
    if (!text) return;
    rtc.sendChat(text, hostUsername);
    input.value = '';
  }

  // ── Chat: Viewer ─────────────────────────────────────────────────────────

  document.getElementById('btn-viewer-send-chat').onclick = () => sendViewerChat();
  document.getElementById('viewer-chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendViewerChat();
  });

  function sendViewerChat() {
    const input = document.getElementById('viewer-chat-input');
    const text = input.value.trim();
    if (!text) return;
    rtc.sendChat(text, viewerUsername);
    input.value = '';
  }

  // ── Chat Helpers ─────────────────────────────────────────────────────────

  function buildChatMsg(msg) {
    return `<div class="chat-msg ${msg.role}">
      <span class="username">${escapeHtml(msg.username || `User-${(msg.from || '').slice(0,4)}`)}</span>
      <span class="text">${escapeHtml(msg.text)}</span>
    </div>`;
  }

  function addSystemMessage(containerId, text) {
    const el = document.getElementById(containerId);
    if (el) appendMessage(el, `<div class="system-msg">${escapeHtml(text)}</div>`);
  }

  function appendMessage(container, html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    container.appendChild(div.firstChild || div);
    container.scrollTop = container.scrollHeight;
  }

  // ── Stream Timer ──────────────────────────────────────────────────────────

  function startStreamTimer() {
    streamStartTime = Date.now();
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - streamStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      const el = document.getElementById('stream-timer');
      if (el) el.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  function stopStreamTimer() {
    clearInterval(timerInterval);
  }

  // ── Utilities ────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Stats Collection (for latency display) ───────────────────────────────

  setInterval(async () => {
    if (rtc.peerConnections.size > 0) {
      const stats = await rtc.getConnectionStats();
      if (stats && stats.connection.rtt !== null) {
        console.debug('[Stats] RTT:', stats.connection.rtt, 'ms');
      }
    }
  }, 10000);

})();
