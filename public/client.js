// Global variables to track WebSocket connection and user state
let socket = null;
let currentUsername = null;
let roomId = null;

// Extract roomId from the current URL path
// Expected URL format: http://localhost:3000/chat/room-abc-123
// We split by '/' and get the last segment after 'chat'
function extractRoomIdFromUrl() {
    const pathParts = window.location.pathname.split('/');
    const chatIndex = pathParts.indexOf('chat');
    
    if (chatIndex !== -1 && pathParts.length > chatIndex + 1) {
        return pathParts[chatIndex + 1];
    }
    
    // Fallback: if URL doesn't match expected pattern, use 'default-room'
    console.warn('Could not extract roomId from URL, using default-room');
    return 'default-room';
}

// Initialize chat when DOM is ready
// Since the script is at the end of body, DOM is usually ready, but we check to be safe
if (document.readyState === 'loading') {
    // DOM hasn't finished loading yet, wait for it
    document.addEventListener('DOMContentLoaded', initializeChat);
} else {
    // DOM is already loaded, initialize immediately
    initializeChat();
}

function initializeChat() {
    // Get references to DOM elements we'll need to manipulate
    const usernameModal = document.getElementById('usernameModal');
    const chatContainer = document.getElementById('chatContainer');
    const usernameInput = document.getElementById('usernameInput');
    const usernameSubmit = document.getElementById('usernameSubmit');
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    const messagesContainer = document.getElementById('messagesContainer');
    const roomDisplay = document.getElementById('roomDisplay');
    const currentUsernameDisplay = document.getElementById('currentUsername');
    const connectionStatus = document.getElementById('connectionStatus');
    const statusText = document.getElementById('statusText');
    const statusDot = document.querySelector('.status-dot');

    // Verify all required elements exist
    if (!usernameModal || !chatContainer || !usernameInput || !usernameSubmit || 
        !messageInput || !sendButton || !messagesContainer || !roomDisplay || 
        !currentUsernameDisplay || !statusText || !statusDot) {
        console.error('Error: Some required DOM elements are missing!');
        alert('Error: Page did not load correctly. Please refresh the page.');
        return;
    }

    // Initialize: Extract roomId and set up event listeners
    roomId = extractRoomIdFromUrl();
    roomDisplay.textContent = roomId;

    // Handle username submission
    usernameSubmit.addEventListener('click', handleUsernameSubmit);
    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleUsernameSubmit();
        }
    });

    // Store references globally for use in other functions
    window.chatElements = {
        usernameModal,
        chatContainer,
        usernameInput,
        usernameSubmit,
        messageInput,
        sendButton,
        messagesContainer,
        roomDisplay,
        currentUsernameDisplay,
        connectionStatus,
        statusText,
        statusDot
    };
    
    // Set up message sending event listeners
    setupMessageSending();
}

function handleUsernameSubmit() {
    const elements = window.chatElements;
    if (!elements) {
        console.error('Chat elements not initialized');
        return;
    }
    
    const username = elements.usernameInput.value.trim();
    
    // Validate username
    if (!username) {
        alert('Please enter a username');
        return;
    }
    
    if (username.length > 50) {
        alert('Username must be 50 characters or less');
        return;
    }
    
    // Store username and set up WebSocket connection
    currentUsername = username;
    elements.currentUsernameDisplay.textContent = currentUsername;
    
    // Hide modal and show chat interface
    elements.usernameModal.classList.add('hidden');
    elements.chatContainer.classList.remove('hidden');
    
    // Establish WebSocket connection
    connectWebSocket();
}

// Establish WebSocket connection to the server
// The WebSocket URL uses ws:// (or wss:// for secure connections)
// We construct the path based on the roomId extracted from the URL
function connectWebSocket() {
    // Determine the protocol (ws or wss) based on current page protocol
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/chat/${roomId}`;
    
    console.log(`Connecting to WebSocket: ${wsUrl}`);
    updateConnectionStatus('Connecting...', 'connecting');
    
    // Create new WebSocket connection
    socket = new WebSocket(wsUrl);
    
    // Event handler: Connection opened successfully
    socket.onopen = function(event) {
        console.log('WebSocket connection opened');
        updateConnectionStatus('Connected', 'connected');
        
        // Send username to server as the first message
        // This tells the server which username is associated with this socket
        const usernameMessage = {
            type: 'setUsername',
            username: currentUsername
        };
        socket.send(JSON.stringify(usernameMessage));
        
        // Focus the message input so user can start typing immediately
        if (window.chatElements && window.chatElements.messageInput) {
            window.chatElements.messageInput.focus();
        }
    };
    
    // Event handler: Message received from server
    socket.onmessage = function(event) {
        try {
            // Parse the JSON message from the server
            const message = JSON.parse(event.data);
            console.log('Message received:', message);
            
            // Display the message in the chat interface
            displayMessage(message);
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    };
    
    // Event handler: Connection closed
    socket.onclose = function(event) {
        console.log('WebSocket connection closed');
        updateConnectionStatus('Disconnected', 'disconnected');
        
        // Optionally attempt to reconnect after a delay
        // For simplicity, we'll just show the disconnected state
        // In a production app, you might implement reconnection logic here
    };
    
    // Event handler: Connection error
    socket.onerror = function(error) {
        console.error('WebSocket error:', error);
        updateConnectionStatus('Connection Error', 'disconnected');
    };
}

// Update the connection status indicator at the bottom of the chat
function updateConnectionStatus(text, status) {
    const elements = window.chatElements;
    if (!elements) return;
    
    elements.statusText.textContent = text;
    
    // Update the status dot color based on connection state
    elements.statusDot.className = 'status-dot';
    if (status === 'connected') {
        elements.statusDot.classList.add('connected');
    } else if (status === 'disconnected') {
        elements.statusDot.classList.add('disconnected');
    }
}

// Display a message in the chat interface
function displayMessage(message) {
    const elements = window.chatElements;
    if (!elements || !elements.messagesContainer) {
        console.error('Cannot display message: messages container not found');
        return;
    }
    
    // Create a new message element
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    // Determine message type for styling
    // System messages (join/leave notifications) are styled differently
    if (message.username === 'System') {
        messageDiv.classList.add('system-message');
    } else if (message.username === currentUsername) {
        // Messages from the current user appear on the right
        messageDiv.classList.add('own-message');
    }
    
    // Build the message HTML structure
    const header = document.createElement('div');
    header.className = 'message-header';
    header.textContent = message.username;
    
    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = message.text;
    
    const timestamp = document.createElement('div');
    timestamp.className = 'message-timestamp';
    // Format timestamp for display (extract time portion from ISO string)
    const time = new Date(message.timestamp).toLocaleTimeString();
    timestamp.textContent = time;
    
    // Assemble the message element
    messageDiv.appendChild(header);
    messageDiv.appendChild(text);
    messageDiv.appendChild(timestamp);
    
    // Add to messages container
    elements.messagesContainer.appendChild(messageDiv);
    
    // Auto-scroll to bottom to show the latest message
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

// Set up message sending event listeners (called after DOM is ready)
function setupMessageSending() {
    const elements = window.chatElements;
    if (!elements) return;
    
    elements.sendButton.addEventListener('click', sendMessage);
    elements.messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
}

function sendMessage() {
    const elements = window.chatElements;
    if (!elements) {
        console.error('Chat elements not initialized');
        return;
    }
    
    const messageText = elements.messageInput.value.trim();
    
    // Don't send empty messages
    if (!messageText) {
        return;
    }
    
    // Check if WebSocket is open (readyState 1 = OPEN)
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        alert('Not connected to server. Please refresh the page.');
        return;
    }
    
    // Create message object to send to server
    // The server will add username and timestamp, so we only send the text
    const message = {
        text: messageText
    };
    
    // Send message as JSON string
    socket.send(JSON.stringify(message));
    
    // Clear the input field
    elements.messageInput.value = '';
    elements.messageInput.focus();
}

