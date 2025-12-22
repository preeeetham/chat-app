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
// Phase 1: User Identity System
// 1. userObjects: Maps userId -> user object { id, username, online, sockets }
//    This creates persistent user identity separate from connections
// 2. socketToUser: Maps WebSocket socket -> userId
//    This allows us to find which user a socket belongs to
// 3. rooms: Maps roomId -> Set of WebSocket connections in that room
//    This allows us to quickly find all clients in a specific room for broadcasting
// 4. roomMessages: Maps roomId -> Array of recent messages (chat history)
//    This stores recent messages so new users can see what happened before they joined
const userObjects = new Map(); // userId -> user object
const socketToUser = new Map(); // socket -> userId
const rooms = new Map();
const roomMessages = new Map();
const MAX_MESSAGES_PER_ROOM = 100; // Limit history to prevent memory issues

// Phase 2: Relationship Graph (Contacts / Friends)
// Maps userId -> Set<userId> (bidirectional relationships)
const relationships = new Map(); // userId -> Set of userIds (their contacts)

// Phase 4: Presence System
// Track which rooms users are in and their online status
const roomMembers = new Map(); // roomId -> Set<userId> (users in this room)
const userRooms = new Map(); // userId -> Set<roomId> (rooms this user is in)

// Phase 5 & 6: Direct Messaging
// Maps "userIdA:userIdB" (sorted) -> Array of DM messages
const dmHistory = new Map();
const MAX_DM_MESSAGES = 100; // Limit DM history size

// Helper function to generate a unique userId
// Using a simple incremental counter for now (can be upgraded to UUID later)
let userIdCounter = 1;
function generateUserId() {
  return `user-${userIdCounter++}`;
}

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

// Phase 2: Relationship Graph Functions
// Add a bidirectional contact relationship between two users
function addContact(userIdA, userIdB) {
  if (userIdA === userIdB) {
    fastify.log.warn(`Cannot add self as contact: ${userIdA}`);
    return false;
  }
  
  if (!userObjects.has(userIdA) || !userObjects.has(userIdB)) {
    fastify.log.warn(`Cannot add contact: one or both users don't exist`);
    return false;
  }
  
  // Initialize Sets if they don't exist
  if (!relationships.has(userIdA)) {
    relationships.set(userIdA, new Set());
  }
  if (!relationships.has(userIdB)) {
    relationships.set(userIdB, new Set());
  }
  
  // Add bidirectional relationship
  relationships.get(userIdA).add(userIdB);
  relationships.get(userIdB).add(userIdA);
  
  fastify.log.info(`Added contact relationship: ${userIdA} <-> ${userIdB}`);
  return true;
}

// Remove a bidirectional contact relationship
function removeContact(userIdA, userIdB) {
  if (relationships.has(userIdA)) {
    relationships.get(userIdA).delete(userIdB);
  }
  if (relationships.has(userIdB)) {
    relationships.get(userIdB).delete(userIdA);
  }
  
  fastify.log.info(`Removed contact relationship: ${userIdA} <-> ${userIdB}`);
  return true;
}

// Get list of contacts for a user
function getContacts(userId) {
  return relationships.get(userId) || new Set();
}

// Check if two users are contacts
function areContacts(userIdA, userIdB) {
  const contactsA = relationships.get(userIdA);
  return contactsA ? contactsA.has(userIdB) : false;
}

// Phase 3: Mutual Relationships
// Get mutual contacts between two users (derived/computed, not stored)
function getMutuals(userIdA, userIdB) {
  const contactsA = relationships.get(userIdA) || new Set();
  const contactsB = relationships.get(userIdB) || new Set();
  
  // Find intersection of both contact sets
  const mutuals = [...contactsA].filter(id => contactsB.has(id));
  return mutuals;
}

// Phase 4: Presence System Functions
// Broadcast presence update to all contacts of a user
function broadcastPresenceUpdate(userId, status, roomId = null) {
  const contacts = getContacts(userId);
  const user = userObjects.get(userId);
  
  if (!user) return;
  
  const presenceUpdate = {
    type: 'presence-update',
    userId: userId,
    username: user.username,
    status: status, // 'online' or 'offline'
    roomId: roomId || null
  };
  
  contacts.forEach(contactId => {
    const contactUser = userObjects.get(contactId);
    if (contactUser) {
      // Send to all sockets of the contact
      contactUser.sockets.forEach(contactSocket => {
        if (contactSocket.readyState === 1) {
          contactSocket.send(JSON.stringify(presenceUpdate));
        }
      });
    }
  });
  
  fastify.log.info(`Broadcasted presence update for user "${userId}": ${status} ${roomId ? `in room ${roomId}` : ''}`);
}

// Get online contacts for a user
function getOnlineContacts(userId) {
  const contacts = getContacts(userId);
  const onlineContacts = [];
  
  contacts.forEach(contactId => {
    const contactUser = userObjects.get(contactId);
    if (contactUser && contactUser.online) {
      const rooms = Array.from(userRooms.get(contactId) || []);
      onlineContacts.push({
        userId: contactId,
        username: contactUser.username,
        rooms: rooms
      });
    }
  });
  
  return onlineContacts;
}

// Get contacts in a specific room
function getContactsInRoom(userId, roomId) {
  const contacts = getContacts(userId);
  const roomUserIds = roomMembers.get(roomId) || new Set();
  
  return Array.from(contacts).filter(contactId => roomUserIds.has(contactId)).map(contactId => {
    const contactUser = userObjects.get(contactId);
    return {
      userId: contactId,
      username: contactUser ? contactUser.username : 'Unknown',
      online: contactUser ? contactUser.online : false
    };
  });
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
          
          // Phase 1: User Identity System
          // Check if this socket already has a userId (user reconnecting or multiple tabs)
          let userId = socketToUser.get(socket);
          let user;
          
          if (userId && userObjects.has(userId)) {
            // Existing user - update their information
            user = userObjects.get(userId);
            user.username = username; // Update username if changed
            user.online = true;
            if (!user.sockets.has(socket)) {
              user.sockets.add(socket); // Add this socket (multiple tabs support)
            }
            fastify.log.info(`Existing user "${userId}" (${username}) connected via new socket in room "${roomId}"`);
          } else {
            // New user - create user object with generated userId
            userId = generateUserId();
            user = {
              id: userId,
              username: username,
              online: true,
              sockets: new Set([socket]) // Start with this socket
            };
            userObjects.set(userId, user);
            fastify.log.info(`New user "${userId}" (${username}) created and registered in room "${roomId}"`);
          }
          
          // Map socket to userId
          socketToUser.set(socket, userId);
          
          // Phase 4: Track user in room for presence system
          if (!roomMembers.has(roomId)) {
            roomMembers.set(roomId, new Set());
          }
          roomMembers.get(roomId).add(userId);
          
          if (!userRooms.has(userId)) {
            userRooms.set(userId, new Set());
          }
          userRooms.get(userId).add(roomId);
          
          // Send userId to client (one-time communication)
          if (socket.readyState === 1) {
            socket.send(JSON.stringify({
              type: 'userId-assigned',
              userId: userId,
              username: username
            }));
          }
          
          // Phase 4: Broadcast presence update to user's contacts (only if newly online)
          if (user.sockets.size === 1) { // Only broadcast if this is the first socket (user just came online)
            broadcastPresenceUpdate(userId, 'online', roomId);
          }

          // Get list of existing users in the room (excluding the new user)
          const existingUsernames = [];
          const roomSockets = rooms.get(roomId);
          if (roomSockets) {
            roomSockets.forEach((existingSocket) => {
              if (existingSocket !== socket) { // Don't include the new user
                const existingUserId = socketToUser.get(existingSocket);
                if (existingUserId && userObjects.has(existingUserId)) {
                  const existingUser = userObjects.get(existingUserId);
                  existingUsernames.push(existingUser.username);
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
            fastify.log.info(`Sent ${messages.length} previous message(s) to user "${userId}" (${username}) in room "${roomId}"`);
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

        // Phase 2: Handle contact management messages
        if (messageData.type === 'add-contact') {
          const targetUserId = messageData.userId;
          if (!targetUserId) {
            fastify.log.warn('add-contact message missing userId');
            return;
          }
          
          const userId = socketToUser.get(socket);
          if (!userId) {
            fastify.log.warn('add-contact from socket without userId');
            return;
          }
          
          const success = addContact(userId, targetUserId);
          
          // Send response to client
          if (socket.readyState === 1) {
            socket.send(JSON.stringify({
              type: 'contact-added',
              userId: targetUserId,
              success: success
            }));
          }
          
          // If successful, also notify the other user (if they're online)
          if (success && userObjects.has(targetUserId)) {
            const targetUser = userObjects.get(targetUserId);
            targetUser.sockets.forEach((targetSocket) => {
              if (targetSocket.readyState === 1) {
                targetSocket.send(JSON.stringify({
                  type: 'contact-added',
                  userId: userId,
                  success: true
                }));
              }
            });
          }
          
          return;
        }
        
        if (messageData.type === 'remove-contact') {
          const targetUserId = messageData.userId;
          if (!targetUserId) {
            fastify.log.warn('remove-contact message missing userId');
            return;
          }
          
          const userId = socketToUser.get(socket);
          if (!userId) {
            fastify.log.warn('remove-contact from socket without userId');
            return;
          }
          
          removeContact(userId, targetUserId);
          
          // Send response to client
          if (socket.readyState === 1) {
            socket.send(JSON.stringify({
              type: 'contact-removed',
              userId: targetUserId,
              success: true
            }));
          }
          
          return;
        }
        
        if (messageData.type === 'get-contacts') {
          const userId = socketToUser.get(socket);
          if (!userId) {
            fastify.log.warn('get-contacts from socket without userId');
            return;
          }
          
          const contactIds = Array.from(getContacts(userId));
          const contactsList = contactIds.map(contactId => {
            const contactUser = userObjects.get(contactId);
            return {
              userId: contactId,
              username: contactUser ? contactUser.username : 'Unknown',
              online: contactUser ? contactUser.online : false
            };
          });
          
          // Send contacts list to client
          if (socket.readyState === 1) {
            socket.send(JSON.stringify({
              type: 'contacts-list',
              contacts: contactsList
            }));
          }
          
          return;
        }
        
        // Phase 3: Handle mutual relationships query
        if (messageData.type === 'get-mutuals') {
          const otherUserId = messageData.userId;
          if (!otherUserId) {
            fastify.log.warn('get-mutuals message missing userId');
            return;
          }
          
          const userId = socketToUser.get(socket);
          if (!userId) {
            fastify.log.warn('get-mutuals from socket without userId');
            return;
          }
          
          const mutualIds = getMutuals(userId, otherUserId);
          const mutualsList = mutualIds.map(mutualId => {
            const mutualUser = userObjects.get(mutualId);
            return {
              userId: mutualId,
              username: mutualUser ? mutualUser.username : 'Unknown',
              online: mutualUser ? mutualUser.online : false
            };
          });
          
          // Send mutuals list to client
          if (socket.readyState === 1) {
            socket.send(JSON.stringify({
              type: 'mutuals-list',
              userId: otherUserId,
              mutuals: mutualsList
            }));
          }
          
          return;
        }
        
        // Phase 4: Handle presence queries
        if (messageData.type === 'get-online-contacts') {
          const userId = socketToUser.get(socket);
          if (!userId) {
            fastify.log.warn('get-online-contacts from socket without userId');
            return;
          }
          
          const onlineContacts = getOnlineContacts(userId);
          
          if (socket.readyState === 1) {
            socket.send(JSON.stringify({
              type: 'online-contacts-list',
              contacts: onlineContacts
            }));
          }
          
          return;
        }
        
        if (messageData.type === 'get-contacts-in-room') {
          const userId = socketToUser.get(socket);
          if (!userId) {
            fastify.log.warn('get-contacts-in-room from socket without userId');
            return;
          }
          
          const contactsInRoom = getContactsInRoom(userId, roomId);
          
          if (socket.readyState === 1) {
            socket.send(JSON.stringify({
              type: 'contacts-in-room-list',
              roomId: roomId,
              contacts: contactsInRoom
            }));
          }
          
          return;
        }
        
        // Phase 5: Handle direct messages (DM)
        if (messageData.type === 'direct-message') {
          const targetUserId = messageData.to;
          const messageText = messageData.text;
          
          if (!targetUserId || !messageText) {
            fastify.log.warn('direct-message missing required fields');
            return;
          }
          
          const senderUserId = socketToUser.get(socket);
          if (!senderUserId || !userObjects.has(senderUserId)) {
            fastify.log.warn('direct-message from socket without registered user');
            return;
          }
          
          // Validate relationship - only allow DM if users are contacts
          if (!areContacts(senderUserId, targetUserId)) {
            fastify.log.warn(`Direct message blocked: ${senderUserId} and ${targetUserId} are not contacts`);
            if (socket.readyState === 1) {
              socket.send(JSON.stringify({
                type: 'dm-error',
                error: 'Users must be contacts to send direct messages'
              }));
            }
            return;
          }
          
          const senderUser = userObjects.get(senderUserId);
          const targetUser = userObjects.get(targetUserId);
          
          if (!targetUser) {
            fastify.log.warn(`Direct message target user ${targetUserId} not found`);
            return;
          }
          
          // Create DM message object
          const dmMessage = {
            type: 'direct-message',
            from: senderUserId,
            fromUsername: senderUser.username,
            to: targetUserId,
            toUsername: targetUser.username,
            text: messageText,
            timestamp: new Date().toISOString()
          };
          
          // Phase 6: Store DM in history (sorted key for bidirectional access)
          const dmKey = [senderUserId, targetUserId].sort().join(':');
          if (!dmHistory.has(dmKey)) {
            dmHistory.set(dmKey, []);
          }
          const dmMessages = dmHistory.get(dmKey);
          dmMessages.push(dmMessage);
          if (dmMessages.length > MAX_DM_MESSAGES) {
            dmMessages.shift(); // Remove oldest
          }
          
          fastify.log.info(`DM from ${senderUserId} (${senderUser.username}) to ${targetUserId} (${targetUser.username}): ${messageText}`);
          
          // Send to all sockets of the target user
          let sentToTarget = false;
          targetUser.sockets.forEach((targetSocket) => {
            if (targetSocket.readyState === 1) {
              targetSocket.send(JSON.stringify(dmMessage));
              sentToTarget = true;
            }
          });
          
          // Also send confirmation back to sender (so they see their own message)
          if (socket.readyState === 1) {
            socket.send(JSON.stringify(dmMessage));
          }
          
          if (!sentToTarget) {
            fastify.log.info(`DM to ${targetUserId} queued (user offline)`);
          }
          
          return;
        }
        
        // Phase 6: Handle DM history requests
        if (messageData.type === 'get-dm-history') {
          const otherUserId = messageData.userId;
          if (!otherUserId) {
            fastify.log.warn('get-dm-history missing userId');
            return;
          }
          
          const userId = socketToUser.get(socket);
          if (!userId) {
            fastify.log.warn('get-dm-history from socket without userId');
            return;
          }
          
          // Validate relationship
          if (!areContacts(userId, otherUserId)) {
            fastify.log.warn(`DM history access blocked: ${userId} and ${otherUserId} are not contacts`);
            return;
          }
          
          // Get DM history (sorted key for bidirectional access)
          const dmKey = [userId, otherUserId].sort().join(':');
          const history = dmHistory.get(dmKey) || [];
          
          if (socket.readyState === 1) {
            socket.send(JSON.stringify({
              type: 'dm-history',
              userId: otherUserId,
              messages: history
            }));
          }
          
          return;
        }

        // Otherwise, treat it as a regular chat message
        // Validate that the message has required fields
        if (!messageData.text || typeof messageData.text !== 'string') {
          fastify.log.warn('Received invalid message: missing or invalid text field');
          return;
        }

        // Phase 1: Get user information via userId
        const userId = socketToUser.get(socket);
        if (!userId || !userObjects.has(userId)) {
          fastify.log.warn('Received message from socket without registered user');
          return;
        }
        const user = userObjects.get(userId);
        const username = user.username;

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
      // Phase 1: Get user information via userId
      const userId = socketToUser.get(socket);
      let username = 'Unknown';
      
      if (userId && userObjects.has(userId)) {
        const user = userObjects.get(userId);
        username = user.username;
        
        // Remove this socket from user's socket set
        user.sockets.delete(socket);
        
        // If user has no more sockets, mark as offline
        if (user.sockets.size === 0) {
          user.online = false;
          fastify.log.info(`User "${userId}" (${username}) went offline - no more sockets`);
          
          // Phase 4: Broadcast offline presence update
          broadcastPresenceUpdate(userId, 'offline');
        } else {
          fastify.log.info(`Socket disconnected for user "${userId}" (${username}), ${user.sockets.size} socket(s) remaining`);
        }
        
        // Phase 4: Remove user from room tracking
        if (roomMembers.has(roomId)) {
          roomMembers.get(roomId).delete(userId);
        }
        if (userRooms.has(userId)) {
          userRooms.get(userId).delete(roomId);
        }
      }
      
      fastify.log.info(`Socket disconnected from room "${roomId}" for user "${username}"`);

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

      // Remove the socket to userId mapping (but keep user object)
      socketToUser.delete(socket);

      // Note: We keep the message history and user objects even after users leave
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

