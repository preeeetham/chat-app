const fastify = require('fastify')({ logger: true });
const path = require('path');

// Register plugins: WebSocket support and static file serving
fastify.register(require('@fastify/websocket'));
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
  prefix: '/', // Serve files from root path
});

// Hook to serve index.html for /chat/* GET requests (but not WebSocket upgrades)
// This must be registered AFTER plugins but will run BEFORE route matching
fastify.addHook('onRequest', async (request, reply) => {
  // Only handle GET requests to /chat/* that are NOT WebSocket upgrades
  if (request.method === 'GET' && 
      request.url.startsWith('/chat/') &&
      (!request.headers.upgrade || request.headers.upgrade.toLowerCase() !== 'websocket')) {
    // Extract the roomId for logging
    const roomId = request.url.split('/chat/')[1]?.split('?')[0];
    fastify.log.info(`Serving index.html for room: ${roomId}`);
    await reply.sendFile('index.html');
    return; // Stop further processing
  }
});

// In-memory state management
// We use three Maps to track the state of all connections:
// 1. rooms: Maps roomId -> Set of WebSocket connections in that room
//    This allows us to quickly find all clients in a specific room for broadcasting
// 2. users: Maps WebSocket connection -> username
//    This lets us retrieve the username when a message is received from a socket
// 3. roomMessages: Maps roomId -> Array of recent messages (chat history)
//    This stores recent messages so new users can see what happened before they joined
const rooms = new Map();
const users = new Map();
const roomMessages = new Map();
const MAX_MESSAGES_PER_ROOM = 100; // Limit history to prevent memory issues

// Helper function to remove a socket from a room and clean up if room is empty
function removeSocketFromRoom(socket, roomId) {
  const roomSockets = rooms.get(roomId);
  if (roomSockets) {
    roomSockets.delete(socket);
    // If the room is now empty, we can optionally remove it from the Map
    // to free up memory (though Maps handle this automatically)
    if (roomSockets.size === 0) {
      rooms.delete(roomId);
      fastify.log.info(`Room "${roomId}" is now empty and has been cleaned up`);
    }
  }
}

// Helper function to broadcast a message to sockets in a room
// If excludeSocket is provided, message is sent to all sockets except that one
// If excludeSocket is null, message is sent to all sockets (including the sender)
function broadcastToRoom(roomId, message, excludeSocket = null) {
  const roomSockets = rooms.get(roomId);
  if (!roomSockets) {
    fastify.log.warn(`Attempted to broadcast to non-existent room: ${roomId}`);
    return;
  }

  // Convert the message object to JSON string for WebSocket transmission
  const messageString = JSON.stringify(message);
  
  let sentCount = 0;
  // Iterate through all sockets in the room and send the message
  roomSockets.forEach((socket) => {
    // Skip the excluded socket if one is provided (otherwise send to all)
    if (socket !== excludeSocket && socket.readyState === 1) { // 1 = OPEN
      socket.send(messageString);
      sentCount++;
    }
  });
  
  fastify.log.info(`Broadcasted message in room "${roomId}" to ${sentCount} client(s)`);
}

// Register WebSocket and HTTP routes for /chat/:roomId
fastify.register(async function (fastify) {
  // WebSocket route - handles WebSocket upgrade requests
  fastify.get('/chat/:roomId', { websocket: true }, (connection, request) => {
    // Extract roomId from URL parameters
    const roomId = request.params.roomId;
    const socket = connection.socket;

    fastify.log.info(`New WebSocket connection attempt for room: ${roomId}`);

    // Add this socket to the room's Set of connections
    // If the room doesn't exist yet, create a new Set for it
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
      fastify.log.info(`Created new room: ${roomId}`);
    }
    rooms.get(roomId).add(socket);
    fastify.log.info(`Socket added to room "${roomId}". Room now has ${rooms.get(roomId).size} client(s)`);

    // Handle incoming messages from this client
    // All messages come through this single handler, so we check the message type
    socket.on('message', (messageBuffer) => {
      try {
        // WebSocket messages come as Buffer objects, convert to string then parse JSON
        const messageString = messageBuffer.toString();
        const messageData = JSON.parse(messageString);

        // Check if this is a username registration message
        // The client sends this as the first message after connecting
        if (messageData.type === 'setUsername' && messageData.username) {
          const username = messageData.username.trim();
          
          // Store the username associated with this socket
          users.set(socket, username);
          
          fastify.log.info(`Username "${username}" registered for socket in room "${roomId}"`);

          // Get list of existing users in the room (excluding the new user)
          const existingUsernames = [];
          const roomSockets = rooms.get(roomId);
          if (roomSockets) {
            roomSockets.forEach((existingSocket) => {
              if (existingSocket !== socket) { // Don't include the new user
                const existingUsername = users.get(existingSocket);
                if (existingUsername) {
                  existingUsernames.push(existingUsername);
                }
              }
            });
          }

          // Send recent chat history to the new user
          const messages = roomMessages.get(roomId);
          if (messages && messages.length > 0) {
            // Send each message from history to the new user
            messages.forEach((message) => {
              if (socket.readyState === 1) { // 1 = OPEN
                socket.send(JSON.stringify(message));
              }
            });
            fastify.log.info(`Sent ${messages.length} previous message(s) to new user "${username}" in room "${roomId}"`);
          }

          // If there are existing users, send a welcome message to the new user
          if (existingUsernames.length > 0) {
            const userListText = existingUsernames.length === 1 
              ? existingUsernames[0] 
              : existingUsernames.slice(0, -1).join(', ') + ' and ' + existingUsernames[existingUsernames.length - 1];
            
            const welcomeMessage = {
              username: 'System',
              text: `Users in room: ${userListText}`,
              timestamp: new Date().toISOString(),
            };
            // Send directly to the new user's socket
            if (socket.readyState === 1) { // 1 = OPEN
              socket.send(JSON.stringify(welcomeMessage));
            }
          }

          // Notify others in the room that a new user joined
          const joinNotification = {
            username: 'System',
            text: `${username} joined the room`,
            timestamp: new Date().toISOString(),
          };
          broadcastToRoom(roomId, joinNotification, socket); // Don't notify the user themselves
          return; // Exit early, username registration is handled
        }

        // Otherwise, treat it as a regular chat message
        // Validate that the message has required fields
        if (!messageData.text || typeof messageData.text !== 'string') {
          fastify.log.warn('Received invalid message: missing or invalid text field');
          return;
        }

        // Get the username associated with this socket
        const username = users.get(socket);
        if (!username) {
          fastify.log.warn('Received message from socket without username');
          return;
        }

        // Create a complete message object with all required fields
        const messageToBroadcast = {
          username: username,
          text: messageData.text,
          timestamp: new Date().toISOString(), // ISO 8601 format for consistent timestamps
        };

        fastify.log.info(`Message from ${username} in room "${roomId}": ${messageData.text}`);

        // Store the message in room history (excluding system messages like join/leave)
        // Only store regular user messages to keep history clean
        if (!roomMessages.has(roomId)) {
          roomMessages.set(roomId, []);
        }
        const messages = roomMessages.get(roomId);
        messages.push(messageToBroadcast);
        
        // Limit the history size to prevent memory issues
        if (messages.length > MAX_MESSAGES_PER_ROOM) {
          messages.shift(); // Remove the oldest message
        }

        // Broadcast the message to all clients in the same room (including the sender)
        // The client-side code will style the sender's own messages differently
        broadcastToRoom(roomId, messageToBroadcast, null); // Pass null to include all sockets including sender
      } catch (error) {
        fastify.log.error(`Error processing message: ${error.message}`);
      }
    });

    // Handle client disconnection
    // This is critical for cleanup to prevent memory leaks
    socket.on('close', () => {
      // Get the username before removing the socket
      const username = users.get(socket) || 'Unknown';
      fastify.log.info(`Socket disconnected for user "${username}" in room "${roomId}"`);

      // Notify remaining users in the room that someone left
      // Broadcast BEFORE removing the socket so we can exclude it from the broadcast
      const leaveNotification = {
        username: 'System',
        text: `${username} left the room`,
        timestamp: new Date().toISOString(),
      };
      broadcastToRoom(roomId, leaveNotification, socket); // Exclude the leaving user

      // Remove the socket from the room
      removeSocketFromRoom(socket, roomId);

      // Remove the username mapping
      users.delete(socket);

      // Note: We keep the message history even after users leave
      // This allows new users to see recent conversation history
      // History will be cleared when the server restarts (in-memory only)
    });

    // Handle WebSocket errors
    socket.on('error', (error) => {
      fastify.log.error(`WebSocket error in room "${roomId}": ${error.message}`);
    });

    fastify.log.info(`WebSocket connection established for room: ${roomId}`);
  });

});


// Start the server
const start = async () => {
  try {
    // Listen on port 3000 (or the PORT environment variable if set)
    await fastify.listen({ port: process.env.PORT || 3000 });
    fastify.log.info(`Server is running on http://localhost:${process.env.PORT || 3000}`);
    fastify.log.info('Ready to accept WebSocket connections at /chat/:roomId');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

