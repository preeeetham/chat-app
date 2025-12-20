# WebSocket Chat App

A simple, educational WebSocket chat application built with Node.js, Fastify, and vanilla JavaScript. This application demonstrates real-time bidirectional communication using WebSockets with room-based messaging.

## Features

- **Room-Based Chat**: Join different chat rooms by navigating to `/chat/room-name`
- **Real-Time Messaging**: Messages are instantly broadcast to all users in the same room
- **Username System**: Enter a display name when joining a chat room
- **Connection Status**: Visual indicator showing WebSocket connection state
- **Clean UI**: Simple, modern interface without external frameworks

## Prerequisites

- Node.js (version 14 or higher)
- npm (comes with Node.js)

## Installation

1. Install dependencies:
```bash
npm install
```

This will install:
- `fastify` - Fast web framework for Node.js
- `@fastify/websocket` - WebSocket support for Fastify
- `@fastify/static` - Static file serving for Fastify

## Running the Server

Start the server with:
```bash
npm start
```

The server will start on `http://localhost:3000` (or the port specified in the `PORT` environment variable).

You should see console output like:
```
[timestamp] Server is running on http://localhost:3000
[timestamp] Ready to accept WebSocket connections at /chat/:roomId
```

## Testing the Application

### Basic Testing with Two Browser Tabs

1. **Start the server** (if not already running):
   ```bash
   npm start
   ```

2. **Open first browser tab**:
   - Navigate to: `http://localhost:3000/chat/test-room`
   - Enter username: `Alice`
   - You should see the chat interface appear

3. **Open second browser tab**:
   - Navigate to: `http://localhost:3000/chat/test-room` (same room)
   - Enter username: `Bob`
   - Both tabs should now show the chat interface

4. **Send messages**:
   - Type a message in Alice's tab and press Enter or click Send
   - The message should appear in both Alice's and Bob's windows
   - Send a message from Bob's tab
   - It should appear in both windows

5. **Test disconnect**:
   - Close one of the browser tabs
   - Check the server console - you should see disconnect logs
   - The remaining tab should show a system message that the user left

### Testing Different Rooms

- Open `http://localhost:3000/chat/room-1` and `http://localhost:3000/chat/room-2` in different tabs
- Send messages in room-1 - they should NOT appear in room-2
- This demonstrates that rooms are isolated from each other

## Expected Server Console Logs

When testing, you should see logs like:

```
[timestamp] Server is running on http://localhost:3000
[timestamp] Ready to accept WebSocket connections at /chat/:roomId
[timestamp] New WebSocket connection attempt for room: test-room
[timestamp] Created new room: test-room
[timestamp] Socket added to room "test-room". Room now has 1 client(s)
[timestamp] WebSocket connection established for room: test-room
[timestamp] Username "Alice" registered for socket in room "test-room"
[timestamp] New WebSocket connection attempt for room: test-room
[timestamp] Socket added to room "test-room". Room now has 2 client(s)
[timestamp] Username "Bob" registered for socket in room "test-room"
[timestamp] Message from Alice in room "test-room": Hello Bob!
[timestamp] Broadcasted message in room "test-room" to 2 client(s)
[timestamp] Socket disconnected for user "Alice" in room "test-room"
[timestamp] Room "test-room" is now empty and has been cleaned up
```

## Project Structure

```
chat-app/
├── server.js              # Fastify server with WebSocket handling
├── package.json           # Dependencies and scripts
├── REQUIREMENTS.md        # Detailed requirements document
├── README.md             # This file
└── public/               # Frontend files served statically
    ├── index.html        # Main HTML page
    ├── style.css         # Styling
    └── client.js         # Client-side WebSocket logic
```

## How It Works

### Server-Side (`server.js`)

1. **Fastify Setup**: Creates an HTTP server and registers WebSocket and static file plugins
2. **State Management**: Uses two `Map` data structures:
   - `rooms`: Maps roomId → Set of WebSocket connections
   - `users`: Maps WebSocket connection → username
3. **WebSocket Route**: Handles connections at `/chat/:roomId`
4. **Message Handling**: Receives messages, adds username and timestamp, broadcasts to room
5. **Connection Lifecycle**: Tracks connects/disconnects and cleans up state

### Client-Side (`client.js`)

1. **URL Parsing**: Extracts `roomId` from the browser URL path
2. **Username Prompt**: Shows modal to collect username before connecting
3. **WebSocket Connection**: Establishes WebSocket connection to server
4. **Message Display**: Renders incoming messages in the chat interface
5. **Message Sending**: Sends user input to server via WebSocket

## Learning Concepts Demonstrated

- **WebSocket Protocol**: Bidirectional communication between client and server
- **Room-Based Broadcasting**: Selective message delivery to subsets of clients
- **In-Memory State**: Managing connection state without a database
- **Connection Lifecycle**: Proper handling of connect, disconnect, and error events
- **Fastify Integration**: Using Fastify plugins for WebSocket support

## Troubleshooting

**Server won't start:**
- Make sure port 3000 is not in use by another application
- Check that all dependencies are installed (`npm install`)

**Messages not appearing:**
- Check browser console for JavaScript errors
- Verify WebSocket connection status indicator (bottom of chat)
- Check server console for error messages

**Room isolation not working:**
- Ensure you're using different room names in the URL (`/chat/room-1` vs `/chat/room-2`)
- Check that roomId is being extracted correctly from the URL

## Next Steps for Learning

After understanding this basic implementation, consider exploring:

- Persisting messages to a database
- User authentication and authorization
- Private/direct messaging between users
- File/image sharing
- Message history loading
- Rate limiting and spam prevention
- Reconnection logic for dropped connections

