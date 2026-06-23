require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const { Admin, Chef } = require('./models');
const authRoutes = require('./routes/auth');
const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/orders');
const reportRoutes = require('./routes/reports');

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/canteenDB';
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*').split(',').map(o => o.trim());

const app = express();
const server = http.createServer(app);

const corsOptions = {
  origin: CORS_ORIGINS.includes('*') ? '*' : CORS_ORIGINS
};

const io = new Server(server, {
  cors: corsOptions
});

app.use(cors(corsOptions));
app.use(express.json());

// Make io available to every route via req.io, so any route can broadcast
// live updates without importing the socket server directly.
app.use((req, res, next) => {
  req.io = io;
  next();
});




const path = require('path');

// 1. Serve static assets inside your public/ css and js folders
app.use('/public', express.static(path.join(__dirname, 'public')));

// 2. Serve the main landing index.html at the root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 3. Serve folders so you can reach role-specific files
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use('/chef', express.static(path.join(__dirname, 'chef')));
app.use('/student', express.static(path.join(__dirname, 'student')));






// ---------------------------------------------------------------------------
// Socket.IO — students join a room keyed by their email so order-status
// updates can be targeted to exactly the right person, plus a shared
// "kitchen" room for chef/admin dashboards.
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.on('identify', ({ role, email }) => {
    if (role === 'student' && email) {
      socket.join(`student:${email.toLowerCase().trim()}`);
    }
    if (role === 'chef' || role === 'admin') {
      socket.join('kitchen');
    }
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

// Auto-create default admin/chef accounts for first-time setup
async function ensureDefaultAccounts() {
  try {
    const adminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'password123';
    const chefUsername = process.env.DEFAULT_CHEF_USERNAME || 'chef1';
    const chefPassword = process.env.DEFAULT_CHEF_PASSWORD || 'password123';

    const existingAdmin = await Admin.findOne({ username: adminUsername });
    if (!existingAdmin) {
      await new Admin({ username: adminUsername, password: adminPassword }).save();
      console.log(`👤 Default admin created -> ${adminUsername} / ${adminPassword}`);
    }

    const existingChef = await Chef.findOne({ username: chefUsername });
    if (!existingChef) {
      await new Chef({ username: chefUsername, password: chefPassword }).save();
      console.log(`👨‍🍳 Default chef created -> ${chefUsername} / ${chefPassword}`);
    }
  } catch (err) {
    console.error('Error ensuring default accounts:', err.message);
  }
}
mongoose.connection.once('open', ensureDefaultAccounts);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', dbState: mongoose.connection.readyState });
});

// auth.js defines full paths itself (/admin/login, /chef/login, /student/login,
// /student/register) so it's mounted once at /api rather than per-role.
app.use('/api', authRoutes);
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