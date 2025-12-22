// Global variables
let socket = null;
let currentUsername = null;
let currentUserId = null;
let roomId = null;
let activeChatType = 'room'; // 'room' or 'dm'
let activeDmUserId = null; // userId of the active DM conversation
let contacts = new Map(); // userId -> { userId, username, online, inRoom }
let dmConversations = new Map(); // userId -> array of messages

// Extract roomId from URL
function extractRoomIdFromUrl() {
    const pathParts = window.location.pathname.split('/');
    const chatIndex = pathParts.indexOf('chat');
    if (chatIndex !== -1 && pathParts.length > chatIndex + 1) {
        return pathParts[chatIndex + 1];
    }
    console.warn('Could not extract roomId from URL, using default-room');
    return 'default-room';
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeChat);
} else {
    initializeChat();
}

function initializeChat() {
    // Restore userId from localStorage
    const storedUserId = localStorage.getItem('chatUserId');
    const storedUsername = localStorage.getItem('chatUsername');
    if (storedUserId && storedUsername) {
        currentUserId = storedUserId;
        console.log(`Restored userId from localStorage: ${currentUserId}`);
    }
    
    // Get DOM elements
    const elements = {
        // Modal
        usernameModal: document.getElementById('usernameModal'),
        usernameInput: document.getElementById('usernameInput'),
        usernameSubmit: document.getElementById('usernameSubmit'),
        
        // Main container
        chatContainer: document.getElementById('chatContainer'),
        roomDisplay: document.getElementById('roomDisplay'),
        currentUsername: document.getElementById('currentUsername'),
        userIdBadge: document.getElementById('userIdBadge'),
        userStatusIndicator: document.getElementById('userStatusIndicator'),
        connectionStatus: document.getElementById('connectionStatus'),
        statusText: document.getElementById('statusText'),
        statusDot: document.getElementById('statusDot'),
        
        // Sidebar
        sidebarTabs: document.querySelectorAll('.tab-btn'),
        contactsTab: document.getElementById('contactsTab'),
        onlineTab: document.getElementById('onlineTab'),
        roomTab: document.getElementById('roomTab'),
        contactsList: document.getElementById('contactsList'),
        onlineContactsList: document.getElementById('onlineContactsList'),
        roomContactsList: document.getElementById('roomContactsList'),
        addContactBtn: document.getElementById('addContactBtn'),
        refreshOnlineBtn: document.getElementById('refreshOnlineBtn'),
        refreshRoomBtn: document.getElementById('refreshRoomBtn'),
        contactSearch: document.getElementById('contactSearch'),
        clearSearchBtn: document.getElementById('clearSearchBtn'),
        
        // Chat area
        chatTabs: document.querySelectorAll('.chat-tab-btn'),
        roomChatView: document.getElementById('roomChatView'),
        dmChatView: document.getElementById('dmChatView'),
        messagesContainer: document.getElementById('messagesContainer'),
        dmMessagesContainer: document.getElementById('dmMessagesContainer'),
        messageInput: document.getElementById('messageInput'),
        dmMessageInput: document.getElementById('dmMessageInput'),
        sendButton: document.getElementById('sendButton'),
        dmSendButton: document.getElementById('dmSendButton'),
        
        // DM
        dmConversationsList: document.getElementById('dmConversationsList'),
        dmChatActive: document.getElementById('dmChatActive'),
        dmUserName: document.getElementById('dmUserName'),
        dmUserStatus: document.getElementById('dmUserStatus'),
        closeDmBtn: document.getElementById('closeDmBtn'),
        
        // Add contact modal
        addContactModal: document.getElementById('addContactModal'),
        addContactInput: document.getElementById('addContactInput'),
        confirmAddContact: document.getElementById('confirmAddContact'),
        cancelAddContact: document.getElementById('cancelAddContact'),
        closeAddContactModal: document.getElementById('closeAddContactModal'),
    };
    
    // Verify required elements
    const requiredElements = Object.values(elements).filter(el => el === null);
    if (requiredElements.length > 0) {
        console.error('Error: Some required DOM elements are missing!');
        alert('Error: Page did not load correctly. Please refresh the page.');
        return;
    }
    
    // Initialize room
    roomId = extractRoomIdFromUrl();
    elements.roomDisplay.textContent = roomId;
    
    // Store elements globally
    window.chatElements = elements;
    
    // Set up event listeners
    setupEventListeners();
}

function setupEventListeners() {
    const e = window.chatElements;
    
    // Username modal
    e.usernameSubmit.addEventListener('click', handleUsernameSubmit);
    e.usernameInput.addEventListener('keypress', (ev) => {
        if (ev.key === 'Enter') handleUsernameSubmit();
    });
    
    // Sidebar tabs
    e.sidebarTabs.forEach(btn => {
        btn.addEventListener('click', () => switchSidebarTab(btn.dataset.tab));
    });
    
    // Chat type tabs
    e.chatTabs.forEach(btn => {
        btn.addEventListener('click', () => switchChatType(btn.dataset.chatType));
    });
    
    // Contact management
    e.addContactBtn.addEventListener('click', () => showAddContactModal());
    e.confirmAddContact.addEventListener('click', handleAddContact);
    e.cancelAddContact.addEventListener('click', hideAddContactModal);
    e.closeAddContactModal.addEventListener('click', hideAddContactModal);
    e.addContactInput.addEventListener('keypress', (ev) => {
        if (ev.key === 'Enter') handleAddContact();
    });
    
    // Refresh buttons
    e.refreshOnlineBtn.addEventListener('click', refreshOnlineContacts);
    e.refreshRoomBtn.addEventListener('click', refreshContactsInRoom);
    
    // Contact search
    e.contactSearch.addEventListener('input', () => {
        filterContacts();
        updateClearButton();
    });
    e.clearSearchBtn.addEventListener('click', clearSearch);
    
    // Message sending
    e.sendButton.addEventListener('click', sendRoomMessage);
    e.messageInput.addEventListener('keypress', (ev) => {
        if (ev.key === 'Enter') sendRoomMessage();
    });
    
    // DM message sending
    e.dmSendButton.addEventListener('click', sendDirectMessage);
    e.dmMessageInput.addEventListener('keypress', (ev) => {
        if (ev.key === 'Enter') sendDirectMessage();
    });
    
    // Close DM
    e.closeDmBtn.addEventListener('click', closeDmConversation);
    
    // Load contacts on connection
    // This will be called after WebSocket connects
}

function handleUsernameSubmit() {
    const e = window.chatElements;
    const username = e.usernameInput.value.trim();
    
    if (!username) {
        alert('Please enter a username');
        return;
    }
    
    if (username.length > 50) {
        alert('Username must be 50 characters or less');
        return;
    }
    
    currentUsername = username;
    e.currentUsername.textContent = currentUsername;
    
    e.usernameModal.classList.add('hidden');
    e.chatContainer.classList.remove('hidden');
    
    connectWebSocket();
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/chat/${roomId}`;
    
    console.log(`Connecting to WebSocket: ${wsUrl}`);
    updateConnectionStatus('Connecting...', 'connecting');
    
    socket = new WebSocket(wsUrl);
    
    socket.onopen = function() {
        console.log('WebSocket connection opened');
        updateConnectionStatus('Connected', 'connected');
        
        const usernameMessage = {
            type: 'setUsername',
            username: currentUsername
        };
        socket.send(JSON.stringify(usernameMessage));
        
        window.chatElements.messageInput.focus();
    };
    
    socket.onmessage = function(event) {
        try {
            const message = JSON.parse(event.data);
            console.log('Message received:', message);
            handleServerMessage(message);
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    };
    
    socket.onclose = function() {
        console.log('WebSocket connection closed');
        updateConnectionStatus('Disconnected', 'disconnected');
    };
    
    socket.onerror = function(error) {
        console.error('WebSocket error:', error);
        updateConnectionStatus('Connection Error', 'disconnected');
    };
}

function handleServerMessage(message) {
    const e = window.chatElements;
    
    // Handle different message types
    if (message.type === 'userId-assigned') {
        currentUserId = message.userId;
        localStorage.setItem('chatUserId', currentUserId);
        localStorage.setItem('chatUsername', message.username);
        e.userIdBadge.textContent = `ID: ${currentUserId}`;
        e.userStatusIndicator.classList.add('online');
        
        // Load contacts after getting userId
        loadContacts();
        refreshOnlineContacts();
        refreshContactsInRoom();
        return;
    }
    
    if (message.type === 'contacts-list') {
        updateContactsList(message.contacts);
        return;
    }
    
    if (message.type === 'online-contacts-list') {
        updateOnlineContactsList(message.contacts);
        return;
    }
    
    if (message.type === 'contacts-in-room-list') {
        updateRoomContactsList(message.contacts);
        return;
    }
    
    if (message.type === 'contact-added') {
        showNotification(`Contact added: ${message.username}`);
        loadContacts();
        return;
    }
    
    if (message.type === 'contact-removed') {
        showNotification(`Contact removed: ${message.username}`);
        loadContacts();
        return;
    }
    
    if (message.type === 'contact-error') {
        alert(`Error: ${message.message}`);
        return;
    }
    
    if (message.type === 'direct-message') {
        handleDirectMessage(message);
        return;
    }
    
    if (message.type === 'dm-error') {
        alert(`DM Error: ${message.message}`);
        return;
    }
    
    if (message.type === 'dm-history') {
        handleDmHistory(message);
        return;
    }
    
    if (message.type === 'presence-update') {
        handlePresenceUpdate(message);
        return;
    }
    
    // Regular chat message (room or DM)
    if (message.username && message.text) {
        displayMessage(message, activeChatType === 'dm' && activeDmUserId);
    }
}

function updateConnectionStatus(text, status) {
    const e = window.chatElements;
    if (!e) return;
    
    e.statusText.textContent = text;
    e.statusDot.className = 'status-dot';
    if (status === 'connected') {
        e.statusDot.classList.add('connected');
    } else if (status === 'disconnected') {
        e.statusDot.classList.add('disconnected');
    }
}

function displayMessage(message, isDm = false) {
    const e = window.chatElements;
    const container = isDm ? e.dmMessagesContainer : e.messagesContainer;
    
    if (!container) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    if (message.username === 'System') {
        messageDiv.classList.add('system-message');
    } else if (message.username === currentUsername) {
        messageDiv.classList.add('own-message');
    }
    
    if (isDm) {
        messageDiv.classList.add('dm-message');
    }
    
    const header = document.createElement('div');
    header.className = 'message-header';
    header.textContent = message.username;
    
    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = message.text;
    
    const timestamp = document.createElement('div');
    timestamp.className = 'message-timestamp';
    timestamp.textContent = new Date(message.timestamp).toLocaleTimeString();
    
    messageDiv.appendChild(header);
    messageDiv.appendChild(text);
    messageDiv.appendChild(timestamp);
    
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
    
    // Store DM messages
    if (isDm && activeDmUserId) {
        if (!dmConversations.has(activeDmUserId)) {
            dmConversations.set(activeDmUserId, []);
        }
        dmConversations.get(activeDmUserId).push(message);
    }
}

// Sidebar Tab Switching
function switchSidebarTab(tabName) {
    const e = window.chatElements;
    e.sidebarTabs.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    
    e.contactsTab.classList.toggle('active', tabName === 'contacts');
    e.onlineTab.classList.toggle('active', tabName === 'online');
    e.roomTab.classList.toggle('active', tabName === 'room');
    
    if (tabName === 'online') {
        refreshOnlineContacts();
    } else if (tabName === 'room') {
        refreshContactsInRoom();
    }
}

// Chat Type Switching (Room vs DM)
function switchChatType(type) {
    const e = window.chatElements;
    activeChatType = type;
    
    e.chatTabs.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.chatType === type);
    });
    
    e.roomChatView.classList.toggle('active', type === 'room');
    e.dmChatView.classList.toggle('active', type === 'dm');
    
    if (type === 'room') {
        e.messageInput.focus();
    } else {
        if (!activeDmUserId) {
            e.dmChatActive.style.display = 'none';
        } else {
            e.messageInput.focus();
        }
    }
}

// Contact Management
function loadContacts() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    
    socket.send(JSON.stringify({ type: 'get-contacts' }));
}

function updateContactsList(contactsArray) {
    const e = window.chatElements;
    e.contactsList.innerHTML = '';
    
    if (contactsArray.length === 0) {
        e.contactsList.innerHTML = '<div class="empty-state">No contacts yet. Add someone to get started!</div>';
        return;
    }
    
    contactsArray.forEach(contact => {
        contacts.set(contact.userId, contact);
        const item = createContactItem(contact, true);
        e.contactsList.appendChild(item);
    });
}

function updateOnlineContactsList(contactsArray) {
    const e = window.chatElements;
    e.onlineContactsList.innerHTML = '';
    
    if (contactsArray.length === 0) {
        e.onlineContactsList.innerHTML = '<div class="empty-state">No online contacts</div>';
        return;
    }
    
    contactsArray.forEach(contact => {
        const item = createContactItem(contact, false);
        item.addEventListener('click', () => startDmConversation(contact.userId));
        e.onlineContactsList.appendChild(item);
    });
}

function updateRoomContactsList(contactsArray) {
    const e = window.chatElements;
    e.roomContactsList.innerHTML = '';
    
    if (contactsArray.length === 0) {
        e.roomContactsList.innerHTML = '<div class="empty-state">No contacts in this room</div>';
        return;
    }
    
    contactsArray.forEach(contact => {
        const item = createContactItem(contact, false);
        item.addEventListener('click', () => startDmConversation(contact.userId));
        e.roomContactsList.appendChild(item);
    });
}

function createContactItem(contact, showActions = false) {
    const item = document.createElement('div');
    item.className = 'contact-item';
    item.dataset.userId = contact.userId;
    
    const info = document.createElement('div');
    info.className = 'contact-item-info';
    
    const status = document.createElement('div');
    status.className = 'status-indicator';
    if (contact.online) {
        status.classList.add('online');
        if (contact.roomId) {
            status.classList.add('in-room');
        }
    } else {
        status.classList.add('offline');
    }
    
    const name = document.createElement('span');
    name.className = 'contact-name';
    name.textContent = contact.username;
    
    info.appendChild(status);
    info.appendChild(name);
    
    item.appendChild(info);
    
    if (showActions) {
        const actions = document.createElement('div');
        actions.className = 'contact-actions';
        
        const dmBtn = document.createElement('button');
        dmBtn.className = 'icon-btn';
        dmBtn.title = 'Send DM';
        dmBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>';
        dmBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            startDmConversation(contact.userId);
        });
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'icon-btn';
        removeBtn.title = 'Remove Contact';
        removeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        removeBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            removeContact(contact.userId);
        });
        
        actions.appendChild(dmBtn);
        actions.appendChild(removeBtn);
        item.appendChild(actions);
    }
    
    if (contact.roomId) {
        const badge = document.createElement('span');
        badge.className = 'contact-badge';
        badge.textContent = 'In Room';
        info.appendChild(badge);
    }
    
    return item;
}

function filterContacts() {
    const e = window.chatElements;
    const searchTerm = e.contactSearch.value.toLowerCase();
    const items = e.contactsList.querySelectorAll('.contact-item');
    
    items.forEach(item => {
        const name = item.querySelector('.contact-name').textContent.toLowerCase();
        item.style.display = name.includes(searchTerm) ? '' : 'none';
    });
}

function updateClearButton() {
    const e = window.chatElements;
    if (e.clearSearchBtn) {
        e.clearSearchBtn.style.display = e.contactSearch.value.trim() ? 'flex' : 'none';
    }
}

function clearSearch() {
    const e = window.chatElements;
    e.contactSearch.value = '';
    filterContacts();
    updateClearButton();
    e.contactSearch.focus();
}

function showAddContactModal() {
    const e = window.chatElements;
    e.addContactModal.classList.remove('hidden');
    e.addContactInput.value = '';
    e.addContactInput.focus();
}

function hideAddContactModal() {
    const e = window.chatElements;
    e.addContactModal.classList.add('hidden');
}

function handleAddContact() {
    const e = window.chatElements;
    const username = e.addContactInput.value.trim();
    
    if (!username) {
        alert('Please enter a username');
        return;
    }
    
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        alert('Not connected to server');
        return;
    }
    
    socket.send(JSON.stringify({
        type: 'add-contact',
        username: username
    }));
    
    hideAddContactModal();
}

function removeContact(userId) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    
    socket.send(JSON.stringify({
        type: 'remove-contact',
        userId: userId
    }));
}

function refreshOnlineContacts() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    
    socket.send(JSON.stringify({ type: 'get-online-contacts' }));
}

function refreshContactsInRoom() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    
    socket.send(JSON.stringify({ type: 'get-contacts-in-room', roomId: roomId }));
}

// Direct Messaging
function startDmConversation(userId) {
    activeDmUserId = userId;
    activeChatType = 'dm';
    
    const e = window.chatElements;
    const contact = contacts.get(userId);
    
    // Switch to DM view
    e.chatTabs.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.chatType === 'dm');
    });
    e.roomChatView.classList.remove('active');
    e.dmChatView.classList.add('active');
    
    // Show DM chat
    e.dmChatActive.style.display = 'flex';
    e.dmUserName.textContent = contact ? contact.username : 'User';
    e.dmUserStatus.className = 'status-indicator';
    if (contact && contact.online) {
        e.dmUserStatus.classList.add('online');
    }
    
    // Clear and load DM history
    e.dmMessagesContainer.innerHTML = '';
    
    // Load DM history
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'get-dm-history',
            targetUserId: userId
        }));
    }
    
    e.dmMessageInput.focus();
}

function closeDmConversation() {
    activeDmUserId = null;
    const e = window.chatElements;
    e.dmChatActive.style.display = 'none';
}

function sendDirectMessage() {
    const e = window.chatElements;
    
    if (!activeDmUserId) {
        alert('Please select a contact to message');
        return;
    }
    
    const messageText = e.dmMessageInput.value.trim();
    if (!messageText) return;
    
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        alert('Not connected to server');
        return;
    }
    
    socket.send(JSON.stringify({
        type: 'direct-message',
        targetUserId: activeDmUserId,
        text: messageText
    }));
    
    e.dmMessageInput.value = '';
    e.dmMessageInput.focus();
}

function handleDirectMessage(message) {
    // If this DM is from the currently active conversation, display it
    if (activeChatType === 'dm' && activeDmUserId === message.fromUserId) {
        displayMessage(message, true);
    }
    
    // Update DM conversations list if needed
    updateDmConversationsList();
}

function handleDmHistory(message) {
    const e = window.chatElements;
    const history = message.messages || [];
    
    // Store history
    if (activeDmUserId) {
        dmConversations.set(activeDmUserId, history);
        
        // Display all messages
        history.forEach(msg => {
            displayMessage(msg, true);
        });
    }
}

function handlePresenceUpdate(message) {
    // Update contact status if we have them
    if (contacts.has(message.userId)) {
        const contact = contacts.get(message.userId);
        contact.online = message.status === 'online';
        contact.roomId = message.roomId || null;
    }
    
    // Refresh relevant lists
    refreshOnlineContacts();
    refreshContactsInRoom();
}

function updateDmConversationsList() {
    // This could show a list of DM conversations
    // For now, we'll keep it simple
}

function sendRoomMessage() {
    const e = window.chatElements;
    const messageText = e.messageInput.value.trim();
    
    if (!messageText) return;
    
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        alert('Not connected to server');
        return;
    }
    
    socket.send(JSON.stringify({ text: messageText }));
    
    e.messageInput.value = '';
    e.messageInput.focus();
}

function showNotification(message) {
    // Simple notification - could be enhanced with a toast library
    console.log('Notification:', message);
}
