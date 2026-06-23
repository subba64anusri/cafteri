require('dotenv').config();
const bcrypt = require('bcrypt');
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const { Manager } = require('./models');
const authRoutes = require('./routes/auth');
const managerRoutes = require('./routes/manager');
const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/orders');
const reportRoutes = require('./routes/reports');
const canteenRoutes = require('./routes/canteens');

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/canteenDB';
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*').split(',').map(o => o.trim());

const app = express();
const server = http.createServer(app);

const corsOptions = {
  origin: CORS_ORIGINS.includes('*') ? '*' : CORS_ORIGINS
};

const io = new Server(server, { cors: corsOptions });

app.use(cors(corsOptions));
app.use(express.json());

// Serve the static frontend (landing page + manager/chef/student portals)
// directly from this same server, so the whole app runs from one origin.
app.use(express.static(require('path').join(__dirname, 'public')));

// Make io available to every route via req.io, so any route can broadcast
// live updates without importing the socket server directly.
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ---------------------------------------------------------------------------
// Socket.IO — rooms are now scoped PER CANTEEN, which is the core of the
// multi-tenant isolation on the realtime side:
//   - a student joins `student:<email>` (unchanged — order-status updates
//     are targeted to exactly the right person regardless of canteen)
//   - a chef/manager viewing a specific canteen joins `kitchen:<canteenId>`
//     so they only receive events for that canteen's orders/menu, not every
//     canteen on the platform.
// Managers can switch canteens client-side by leaving one kitchen room and
// joining another (handled via the same 'identify' event, re-emitted).
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.on('identify', ({ role, email, canteenId }) => {
    if (role === 'student' && email) {
      socket.join(`student:${email.toLowerCase().trim()}`);
    }
    if ((role === 'chef' || role === 'manager') && canteenId) {
      socket.join(`kitchen:${canteenId}`);
    }
  });

  // Lets a manager move from watching one canteen to another without a full
  // reconnect — leave the old room, join the new one.
  socket.on('switch-canteen', ({ previousCanteenId, canteenId }) => {
    if (previousCanteenId) socket.leave(`kitchen:${previousCanteenId}`);
    if (canteenId) socket.join(`kitchen:${canteenId}`);
  });

  socket.on('disconnect', () => {});
});

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
mongoose.connect(MONGO_URI)
  .then(() => console.log(`✅ Connected to MongoDB at ${MONGO_URI}`))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    console.error('   Is mongod running locally? Check MONGO_URI in your .env file.');
  });

// Auto-create a default manager account for first-time setup. Chefs are
// intentionally NOT auto-created anymore — they must be created by a
// manager through the Chef Management UI, since every chef now needs a
// canteen assignment that only a manager can make.
async function ensureDefaultManager() {
  try {
    const username = process.env.DEFAULT_MANAGER_USERNAME || 'manager';
    const password = process.env.DEFAULT_MANAGER_PASSWORD || 'password123';

    const existing = await Manager.findOne({ username });
    if (!existing) {
      const passwordHash = await bcrypt.hash(password, 10);
      await new Manager({ username, passwordHash, fullName: 'Platform Manager' }).save();
      console.log(`👤 Default manager created -> ${username} / ${password}`);
    }
  } catch (err) {
    console.error('Error ensuring default manager:', err.message);
  }
}
mongoose.connection.once('open', ensureDefaultManager);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', dbState: mongoose.connection.readyState });
});

// auth.js defines full paths itself (/manager/login, /chef/login,
// /student/login, /student/register) so it's mounted once at /api.
app.use('/api', authRoutes);
app.use('/api/manager', managerRoutes);   // manager-only: chef CRUD, canteen CRUD
app.use('/api/canteens', canteenRoutes);  // public-readable canteen list/details
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reports', reportRoutes);

// Friendly 404 for unmatched API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Canteen server running on port ${PORT}`);
});
