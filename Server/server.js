const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const { WebSocket, WebSocketServer } = require("ws");
const { randomUUID } = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/* ===============================
   CONFIG
================================ */
const PORT = process.env.PORT || 8080;

const ALLOWED_ORIGINS = [
  "https://anonchatsgs.web.app",
  "https://anonchatsgs.firebaseapp.com"
];

/* ===============================
   MIDDLEWARE
================================ */
app.use(helmet());
app.use(express.json());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true
  })
);

app.options("*", cors());

/* ===============================
   HEALTH CHECK
================================ */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

/* ===============================
   WEBSOCKET LOGIC
================================ */
const STATES = {
  IDLE: "idle",
  SEARCHING: "searching",
  CONNECTING: "connecting",
  CONNECTED: "connected"
};

const clients = new Map();
let waitingUser = null;

wss.on("connection", (ws, req) => {
  const origin = req.headers.origin;

  // 🔐 WebSocket origin check
  if (!ALLOWED_ORIGINS.includes(origin)) {
    ws.close(1008, "Origin not allowed");
    return;
  }

  const id = randomUUID();
  ws.id = id;

  clients.set(ws, {
    id,
    name: "Anonymous",
    state: STATES.IDLE,
    partner: null
  });

  console.log(`[WS CONNECT] ${id}`);

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      const client = clients.get(ws);
      if (!client) return;

      if (data.type === "join") handleJoin(ws, client, data.name);
      else if (data.type === "signal") handleSignal(ws, client, data);
      else if (data.type === "connected") client.state = STATES.CONNECTED;
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid payload" }));
    }
  });

  ws.on("close", () => handleDisconnect(ws));
  ws.on("error", (err) =>
    console.error(`[WS ERROR] ${id}: ${err.message}`)
  );
});

/* ===============================
   MATCHING FUNCTIONS
================================ */
function handleJoin(ws, client, name) {
  if (client.state === STATES.SEARCHING) return;

  client.name = name || "Stranger";
  client.state = STATES.SEARCHING;

  if (waitingUser && waitingUser !== ws) {
    const partner = waitingUser;
    const partnerData = clients.get(partner);

    if (!partnerData || partnerData.state !== STATES.SEARCHING) {
      waitingUser = ws;
      return;
    }

    waitingUser = null;

    client.state = STATES.CONNECTING;
    client.partner = partner;

    partnerData.state = STATES.CONNECTING;
    partnerData.partner = ws;

    sendJSON(ws, {
      type: "matched",
      initiator: true,
      partnerName: partnerData.name
    });

    sendJSON(partner, {
      type: "matched",
      initiator: false,
      partnerName: client.name
    });
  } else {
    waitingUser = ws;
  }
}

function handleSignal(ws, client, data) {
  if (client.partner && client.partner.readyState === WebSocket.OPEN) {
    sendJSON(client.partner, data);
  }
}

function handleDisconnect(ws) {
  const client = clients.get(ws);
  if (!client) return;

  if (waitingUser === ws) waitingUser = null;

  if (client.partner) {
    const partnerData = clients.get(client.partner);
    if (partnerData) {
      partnerData.partner = null;
      sendJSON(client.partner, { type: "partner-left" });
    }
  }

  clients.delete(ws);
}

/* ===============================
   HELPERS
================================ */
function sendJSON(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

/* ===============================
   EXPRESS ERRORS
================================ */
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error("[SERVER ERROR]", err.message);
  res.status(500).json({ error: "Internal Server Error" });
});

/* ===============================
   START SERVER
================================ */
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
