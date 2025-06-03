require('dotenv').config();

const express = require('express');
const http = require('http');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const { Server } = require('socket.io');

// Models
const User = require('./models/User');
const Room = require('./models/Room');
const Message = require('./models/Message');

// Config
const MONGO_URI = process.env.MONGO_URI;
const SESSION_SECRET = process.env.SESSION_SECRET || 'supersecretkey';
const PORT = process.env.PORT || 2333;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI missing');
  process.exit(1);
}

// Connect to MongoDB
mongoose
  .connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// Express app + HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware: parse bodies and cookies
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(SESSION_SECRET));

// Session store
const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: MongoStore.create({ mongoUrl: MONGO_URI }),
  cookie: { maxAge: 24 * 60 * 60 * 1000 },
});
app.use(sessionMiddleware);

// Passport setup
passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      const user = await User.findOne({ username });
      if (!user || !user.verify(password)) return done(null, false);
      return done(null, user);
    } catch (e) {
      return done(e);
    }
  })
);
passport.serializeUser((u, done) => done(null, u.id));
passport.deserializeUser(async (id, done) => {
  try {
    const u = await User.findById(id);
    done(null, u);
  } catch (e) {
    done(e);
  }
});
app.use(passport.initialize());
app.use(passport.session());

// View engine + static files
app.set('view engine', 'ejs');
app.use(express.static('public'));

// Auth guard
const ensureAuth = (req, res, next) =>
  req.isAuthenticated() ? next() : res.redirect('/login');

// Routes: signup, login, logout, index
app.get('/signup', (req, res) => res.render('signup', { error: null }));
app.post('/signup', async (req, res) => {
  const { username, password, avatar } = req.body;
  try {
    await User.create({ username, password, avatar });
    res.redirect('/login?registered=1');
  } catch {
    res.render('signup', { error: 'Username already exists' });
  }
});

app.get('/login', (req, res) => {
  res.render('login', {
    registered: req.query.registered === '1',
    error: req.query.error === '1',
  });
});
app.post(
  '/login',
  passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login?error=1',
  })
);
app.get('/logout', (req, res) => req.logout(() => res.redirect('/login')));

app.get('/', ensureAuth, async (req, res) => {
  let rooms = await Room.find().sort('name');
  if (!rooms.length) {
    const lobby = await Room.create({ name: 'lobby', createdBy: req.user.username });
    rooms = [lobby];
  }
  res.render('index', { user: req.user, rooms });
});

// Helper to wrap Express middleware for Socket.IO
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);

// Socket.IO session + passport integration
io.use(wrap(cookieParser(SESSION_SECRET)));
io.use(wrap(sessionMiddleware));

io.on('connection', async socket => {
  const uid = socket.request.session.passport?.user;
  if (!uid) {
    console.log('❌ Socket unauthenticated, disconnecting');
    socket.disconnect();
    return;
  }

  socket.user = await User.findById(uid);
  console.log('🟢 Socket connected:', socket.user.username);

  // Send initial room list
  socket.emit('roomList', await Room.find().sort('name'));

  // Handlers
  socket.on('newRoom', async name => {
    if (name?.trim() && !(await Room.exists({ name }))) {
      await Room.create({ name, createdBy: socket.user.username });
      io.emit('roomList', await Room.find().sort('name'));
    }
  });

  socket.on('deleteRoom', async name => {
    const room = await Room.findOne({ name });
    if (room && room.createdBy === socket.user.username) {
      await room.deleteOne();
      io.emit('roomList', await Room.find().sort('name'));
    }
  });

  socket.on('joinRoom', async room => {
    socket.leaveAll();
    socket.join(room);
    const history = await Message.find({ room }).sort('time');
    socket.emit('history', history);
  });

  socket.on('chatMessage', async ({ room, text }) => {
    if (!room || !text.trim()) return;
    const m = await Message.create({
      room,
      user: socket.user.username,
      avatar: socket.user.avatar,
      text,
    });
    io.to(room).emit('message', m);
  });

  // delete a single message
  socket.on('deleteMessage', async messageId => {
    const m = await Message.findById(messageId);
    if (m && m.user === socket.user.username) {
      await Message.deleteOne({ _id: messageId });
      io.to(m.room).emit('messageDeleted', messageId);
    }
  });

  socket.on('typing', room => {
    if (!room) return;
    socket.to(room).emit('typing', socket.user.username);
  });
  socket.on('stopTyping', room => {
    if (!room) return;
    socket.to(room).emit('stopTyping');
  });

  socket.on('seen', async ({ messageId }) => {
    const m = await Message.findById(messageId);
    if (m && !m.seenBy.includes(socket.user.username)) {
      m.seenBy.push(socket.user.username);
      await m.save();
      io.to(m.room).emit('seenUpdate', { id: messageId, seenBy: m.seenBy });
    }
  });

}); // <-- Add this closing brace for io.on('connection', ...)

// Start
server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));