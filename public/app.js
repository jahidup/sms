const BASE_URL = '';
const showMsg = (id, text, type = 'error') => {
  const el = document.getElementById(id);
  if (el) { el.textContent = text; el.className = `message ${type}`; }
};
const setLoading = (id, show) => {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? 'block' : 'none';
};
const token = () => localStorage.getItem('token');
const logout = () => { localStorage.clear(); window.location.href = 'login.html'; };

const path = location.pathname.split('/').pop();

// ========== AUTH PAGES ==========
if (path === 'register.html' || path === '') {
  document.getElementById('regForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    showMsg('msg', ''); setLoading('loading', true);
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showMsg('msg', data.message, 'success');
      setTimeout(() => { location.href = `verify.html?email=${encodeURIComponent(email)}`; }, 1500);
    } catch (e) { showMsg('msg', e.message); }
    finally { setLoading('loading', false); }
  });
}

if (path === 'verify.html') {
  const emailParam = new URLSearchParams(location.search).get('email');
  if (emailParam) document.getElementById('email').value = emailParam;

  document.getElementById('verifyForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const otp = document.getElementById('otp').value.trim();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    showMsg('msg', ''); setLoading('loading', true);
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, password, confirmPassword, username })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showMsg('msg', data.message, 'success');
      setTimeout(() => { location.href = 'login.html'; }, 2000);
    } catch (e) { showMsg('msg', e.message); }
    finally { setLoading('loading', false); }
  });

  document.getElementById('resendBtn')?.addEventListener('click', async () => {
    const email = document.getElementById('email').value.trim();
    setLoading('loading', true);
    try {
      const res = await fetch('/api/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showMsg('msg', data.message, 'success');
    } catch (e) { showMsg('msg', e.message); }
    finally { setLoading('loading', false); }
  });
}

if (path === 'login.html') {
  document.getElementById('loginForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    showMsg('msg', ''); setLoading('loading', true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      localStorage.setItem('token', data.token);
      localStorage.setItem('currentUser', JSON.stringify(data.user));
      location.href = 'chat.html';
    } catch (e) { showMsg('msg', e.message); }
    finally { setLoading('loading', false); }
  });
}

// ========== CHAT PAGE ==========
if (path === 'chat.html') {
  if (!token()) location.href = 'login.html';
  const currentUser = JSON.parse(localStorage.getItem('currentUser'));
  let activeChat = { userId: null, conversationId: null, lastFetch: new Date(0) };
  let replyTo = null;
  let pollingInterval;

  const convList = document.getElementById('convoList');
  const chatArea = document.getElementById('chatArea');
  const messagesDiv = document.getElementById('messages');
  const replyBar = document.getElementById('replyBar');
  const replyingToText = document.getElementById('replyingToText');
  const messageInput = document.getElementById('messageInput');

  // ---------- Fetch helpers ----------
  const api = (url, options = {}) => fetch(url, { ...options, headers: { ...options.headers, 'Authorization': `Bearer ${token()}` } });

  async function loadConversations() {
    const res = await api('/api/conversations');
    const convs = await res.json();
    convList.innerHTML = convs.map(conv => {
      const other = conv.participants.find(p => p._id !== currentUser.id);
      return `<div class="convo-item ${activeChat.userId === other._id ? 'active' : ''}" data-userid="${other._id}">
        <span class="name">${other.name || other.username}</span>
      </div>`;
    }).join('');
    document.querySelectorAll('.convo-item').forEach(el => {
      el.addEventListener('click', () => openChat(el.dataset.userid));
    });
  }

  async function openChat(userId) {
    activeChat.userId = userId;
    activeChat.lastFetch = new Date(0); // reset for full load
    document.getElementById('chatPartnerName').textContent = '...';
    chatArea.classList.remove('hidden');
    // Fetch user details
    const res = await api(`/api/users/search?q=${userId}`); // a bit hacky, but works; in real app you'd have GET /api/user/:id
    // Better: fetch conversations to get name
    const convs = await api('/api/conversations');
    const convsData = await convs.json();
    const conv = convsData.find(c => c.participants.some(p => p._id === userId));
    if (conv) {
      const partner = conv.participants.find(p => p._id === userId);
      document.getElementById('chatPartnerName').textContent = partner.name || partner.username;
      activeChat.conversationId = conv._id;
    } else {
      activeChat.conversationId = null;
    }
    replyTo = null; replyBar.classList.add('hidden');
    await fetchMessages();
    loadConversations(); // update active class
    clearInterval(pollingInterval);
    pollingInterval = setInterval(fetchMessages, 2000);
  }

  async function fetchMessages() {
    if (!activeChat.userId) return;
    const res = await api(`/api/messages/${activeChat.userId}`);
    const msgs = await res.json();
    if (msgs.length > 0 && new Date(msgs[msgs.length-1].createdAt) > activeChat.lastFetch) {
      activeChat.lastFetch = new Date(msgs[msgs.length-1].createdAt);
      renderMessages(msgs);
    } else if (messagesDiv.children.length === 0) {
      renderMessages(msgs);
    }
    // Ensure scroll is at bottom when new messages
    if (messagesDiv.scrollTop + messagesDiv.clientHeight >= messagesDiv.scrollHeight - 20) {
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  }

  function renderMessages(msgs) {
    messagesDiv.innerHTML = '';
    msgs.forEach(msg => {
      const isSent = msg.sender._id === currentUser.id;
      const div = document.createElement('div');
      div.className = `message ${isSent ? 'sent' : 'received'}`;
      div.dataset.messageId = msg._id;
      let html = '';
      if (msg.repliedTo) {
        const repliedMsg = msgs.find(m => m._id === msg.repliedTo);
        if (repliedMsg) {
          html += `<div class="reply-preview">↪ ${repliedMsg.content.substring(0, 30)}</div>`;
        }
      }
      html += `<div class="sender">${msg.sender.username || msg.sender.name}</div>`;
      html += `<div class="text">${msg.content}</div>`;
      if (msg.reactions?.length) {
        html += `<div class="reactions">${msg.reactions.map(r => `<span class="reaction">${r.emoji}</span>`).join('')}</div>`;
      }
      div.innerHTML = html;
      // Actions
      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.innerHTML = `
        <button title="Reply" data-action="reply">↩</button>
        <button title="👍" data-action="react" data-emoji="👍">👍</button>
        <button title="❤️" data-action="react" data-emoji="❤️">❤️</button>
        <button title="😂" data-action="react" data-emoji="😂">😂</button>
      `;
      div.appendChild(actions);
      messagesDiv.appendChild(div);
    });

    // Attach events
    document.querySelectorAll('.actions button').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const msgDiv = e.target.closest('.message');
        const msgId = msgDiv.dataset.messageId;
        const action = e.target.dataset.action;
        if (action === 'reply') {
          replyTo = msgId;
          const text = msgDiv.querySelector('.text')?.textContent || '';
          replyingToText.textContent = `Replying: ${text.substring(0, 25)}...`;
          replyBar.classList.remove('hidden');
        } else if (action === 'react') {
          handleReaction(msgId, e.target.dataset.emoji);
        }
      });
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  async function handleReaction(messageId, emoji) {
    if (!activeChat.conversationId) {
      // Need conversationId, maybe get it fresh
      const convs = await api('/api/conversations');
      const convsData = await convs.json();
      const conv = convsData.find(c => c.participants.some(p => p._id === activeChat.userId));
      if (conv) activeChat.conversationId = conv._id;
      else return alert('Conversation not found');
    }
    try {
      const res = await api('/api/messages/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeChat.conversationId, messageId, emoji })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      // Update UI locally
      const msgDiv = document.querySelector(`.message[data-message-id="${messageId}"]`);
      if (msgDiv) {
        const reactDiv = msgDiv.querySelector('.reactions') || document.createElement('div');
        reactDiv.className = 'reactions';
        reactDiv.innerHTML = data.reactions.map(r => `<span class="reaction">${r.emoji}</span>`).join('');
        if (!msgDiv.querySelector('.reactions')) msgDiv.appendChild(reactDiv);
      }
    } catch (e) { alert(e.message); }
  }

  // ---------- Actions ----------
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });
  async function sendMessage() {
    const content = messageInput.value.trim();
    if (!content || !activeChat.userId) return;
    try {
      const res = await api('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: activeChat.userId, content, repliedTo: replyTo })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      messageInput.value = '';
      replyTo = null; replyBar.classList.add('hidden');
      // Immediately fetch messages to update
      await fetchMessages();
    } catch (e) { alert(e.message); }
  }

  document.getElementById('cancelReply').addEventListener('click', () => {
    replyTo = null; replyBar.classList.add('hidden');
  });

  document.getElementById('blockBtn').addEventListener('click', async () => {
    if (!activeChat.userId) return;
    await api(`/api/block/${activeChat.userId}`, { method: 'POST' });
    alert('User blocked');
  });

  document.getElementById('clearBtn').addEventListener('click', async () => {
    if (!activeChat.userId) return;
    if (confirm('Delete entire conversation?')) {
      await api(`/api/clear/${activeChat.userId}`, { method: 'DELETE' });
      chatArea.classList.add('hidden');
      activeChat = { userId: null, conversationId: null, lastFetch: new Date(0) };
      clearInterval(pollingInterval);
      loadConversations();
    }
  });

  // ---------- Search users ----------
  document.getElementById('searchInput').addEventListener('input', async function () {
    const q = this.value.trim();
    if (q.length < 2) return (document.getElementById('searchResults').innerHTML = '');
    const res = await api(`/api/users/search?q=${q}`);
    const users = await res.json();
    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = users.map(u => `<div class="convo-item" style="cursor:pointer;" data-userid="${u._id}">
      <strong>${u.name}</strong> (${u.username || u.email})
    </div>`).join('');
    document.querySelectorAll('#searchResults .convo-item').forEach(el => {
      el.addEventListener('click', () => {
        openChat(el.dataset.userid);
        document.getElementById('searchInput').value = '';
        resultsDiv.innerHTML = '';
      });
    });
  });

  // Logout button inside chat
  document.getElementById('logoutChatBtn').addEventListener('click', () => {
    clearInterval(pollingInterval);
    logout();
  });

  // Initial load
  loadConversations();
}
