# WebSocket Chat App Requirements (Learning-Focused)

## Tech Stack (Non-Negotiable)

### Backend:
- Node.js with Fastify
- @fastify/websocket for WebSocket handling

### Frontend:
- Plain HTML, CSS, and vanilla JavaScript only
- No frameworks (no React, Vue, Svelte, etc.)
- No build tools or bundlers
- Use native browser WebSocket API

### Data Storage:
- In-memory only (no databases, no Redis)
- Use JavaScript Map or plain objects

### Excluded:
- Authentication/authorization
- TypeScript
- Docker
- Testing frameworks
- ORMs or query builders
- Production optimizations

## Functional Requirements

### 1. Room-Based Chat via URL
- Each room is identified by a unique roomId in the URL path
- Example: `/chat/room-abc-123`
- Anyone with the same URL joins the same room
- No room creation UI needed — rooms exist when someone joins

### 2. Username Entry
- Prompt user for a display name before entering chat
- Store username in memory, associated with their WebSocket connection
- Display username alongside each message

### 3. Real-Time Messaging
- Send/receive messages via WebSocket
- When a user sends a message, broadcast it to all users in that room only
- Each message must include:
  - username (who sent it)
  - text (message content)
  - timestamp (when it was sent)

### 4. Connection Lifecycle
- Handle WebSocket connect/disconnect events
- On disconnect:
  - Remove user from room
  - Optionally broadcast a "user left" notification to remaining users
- Log all connection events server-side for debugging

### 5. In-Memory State Management
- Use clear data structures to track:
  - Which sockets belong to which room
  - Which username belongs to which socket
- Example structure:
  ```javascript
  // rooms: Map<roomId, Set<socket>>
  // users: Map<socket, username>
  ```
- Add inline comments explaining the design choices

## Code Quality Requirements

- Prioritize learning over cleverness:
  - Use descriptive variable names (connectedClients, not cc)
  - Add explanatory comments (why, not just what)
  - Avoid abstractions — keep it simple and explicit
  - Prefer readability over brevity
  - Log key events with context (connect, disconnect, message sent)

### File structure:
- Keep server logic in one file (server.js)
- Keep frontend files separate (public/ folder)
- No unnecessary files or boilerplate

## Deliverables

### 1. server.js
- Fastify setup
- WebSocket upgrade handling
- Room management logic
- Message broadcasting logic
- Connection/disconnection handlers

### 2. public/index.html
- Prompt for username
- Display chat messages
- Input field + send button
- Extract roomId from URL

### 3. public/style.css
- Clean, minimal styling
- No frameworks (no Tailwind, no Bootstrap)
- Make the chat interface readable

### 4. public/client.js
- WebSocket connection setup
- Send messages to server
- Receive and display messages from server
- Handle connection errors

### 5. README.md
- Step-by-step instructions:
  - How to install dependencies
  - How to start the server
  - How to test with two browser tabs
  - Expected console logs for verification

## Output Format

For each file:
- Provide the complete working code
- Add inline comments explaining key sections
- After the code, write a brief explanation (2-4 sentences) about:
  - What this file does
  - How it connects to the rest of the system
  - Any important concepts demonstrated

## Do Not:
- Skip steps or assume existing setup
- Use placeholder comments like // TODO
- Reference external libraries not in the tech stack
- Optimize prematurely

## Testing Scenario

After implementation, I should be able to:
1. Run `npm install` and `npm start`
2. Open `http://localhost:3000/chat/test-room` in browser tab 1
3. Enter username "Alice"
4. Open `http://localhost:3000/chat/test-room` in browser tab 2
5. Enter username "Bob"
6. Send messages from Alice → see them appear in Bob's window
7. Send messages from Bob → see them appear in Alice's window
8. Close one tab → see disconnect logged server-side

## Learning Goals

By building this, I want to understand:
- How WebSocket connections are established and maintained
- How to implement room-based messaging without a database
- How to broadcast messages to specific subsets of clients
- How Fastify integrates with WebSocket handling
- How to manage stateful connections in memory

Keep the code simple, explicit, and well-documented so I can learn these concepts clearly.

