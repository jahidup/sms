require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Allowed email domains ----------
const ALLOWED_DOMAINS = [
  'gmail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com',
  'icloud.com', 'protonmail.com', 'aol.com', 'zoho.com', 'gmx.com',
  'mail.com', 'yandex.com'
];

// ---------- MongoDB ----------
let cachedDb = null;
async function connectDB() {
  if (cachedDb && mongoose.connection.readyState === 1) return cachedDb;
  await mongoose.connect(process.env.MONGO_URI);
  cachedDb = mongoose.connection;
  console.log('MongoDB connected');
}

// ---------- Models ----------
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, lowercase: true },
  password: String,
  username: { type: String, unique: true, sparse: true },
  isVerified: { type: Boolean, default: false },
  otp: String,
  otpExpiry: Date,
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: String,
  repliedTo: { type: mongoose.Schema.Types.ObjectId, default: null },
  reactions: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    emoji: String
  }],
  createdAt: { type: Date, default: Date.now }
});

const conversationSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  messages: [messageSchema]
});
const Conversation = mongoose.model('Conversation', conversationSchema);

// ---------- Mailer ----------
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});
const sendOTP = async (to, otp) => {
  await transporter.sendMail({
    from: `"Chat App" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'OTP for verification',
    html: `<h2>${otp}</h2><p>Expires in 5 minutes</p>`
  });
};

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// ---------- JWT Middleware ----------
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = user;
    next();
  });
};

// ========== AUTH ROUTES ==========

app.post('/api/register', async (req, res) => {
  try {
    await connectDB();
    const { name, email } = req.body;
    if (!name || !email) return res.status(400).json({ message: 'Name and email required' });

    // Domain validation
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain || !ALLOWED_DOMAINS.includes(domain)) {
      return res.status(400).json({ message: `Registration only allowed with popular email providers like Gmail, Outlook, Yahoo, etc.` });
    }

    let user = await User.findOne({ email });
    if (user?.isVerified) return res.status(400).json({ message: 'Email already registered' });

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

    if (!user) user = new User({ name, email, otp, otpExpiry });
    else { user.name = name; user.otp = otp; user.otpExpiry = otpExpiry; }
    await user.save();
    await sendOTP(email, otp);
    res.json({ message: 'OTP sent to your email' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/verify', async (req, res) => {
  try {
    await connectDB();
    const { email, otp, password, confirmPassword, username } = req.body;
    if (!email || !otp || !password || !confirmPassword) return res.status(400).json({ message: 'All fields required' });
    if (password !== confirmPassword) return res.status(400).json({ message: 'Passwords do not match' });
    if (password.length < 6) return res.status(400).json({ message: 'Password min 6 chars' });
    if (!username || username.trim().length < 3) return res.status(400).json({ message: 'Username min 3 chars' });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.isVerified) return res.status(400).json({ message: 'Already verified' });
    if (user.otp !== otp) return res.status(400).json({ message: 'Invalid OTP' });
    if (user.otpExpiry < new Date()) return res.status(400).json({ message: 'OTP expired' });

    const existingUsername = await User.findOne({ username: username.trim() });
    if (existingUsername && existingUsername._id.toString() !== user._id.toString())
      return res.status(400).json({ message: 'Username already taken' });

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    user.username = username.trim();
    user.isVerified = true;
    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();

    res.json({ message: 'Account created – please login' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    await connectDB();
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !user.isVerified) return res.status(400).json({ message: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id, email, username: user.username, name: user.name }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: { id: user._id, name: user.name, username: user.username, email: user.email } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/resend-otp', async (req, res) => {
  try {
    await connectDB();
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.isVerified) return res.status(400).json({ message: 'Already verified' });
    const otp = generateOTP();
    user.otp = otp;
    user.otpExpiry = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();
    await sendOTP(email, otp);
    res.json({ message: 'OTP resent' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ========== CHAT & USER ROUTES ==========

app.get('/api/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password -otp -otpExpiry');
  res.json(user);
});

app.get('/api/users/search', auth, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  const users = await User.find({
    $and: [
      { _id: { $ne: req.user.id } },
      { isVerified: true },
      { $or: [
        { username: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ]}
    ]
  }).select('name username email');
  res.json(users);
});

app.get('/api/conversations', auth, async (req, res) => {
  const convs = await Conversation.find({ participants: req.user.id })
    .populate('participants', 'name username email')
    .lean();
  convs.sort((a, b) => {
    const aLast = a.messages.length ? a.messages[a.messages.length-1].createdAt : a.createdAt;
    const bLast = b.messages.length ? b.messages[b.messages.length-1].createdAt : b.createdAt;
    return new Date(bLast) - new Date(aLast);
  });
  res.json(convs);
});

app.get('/api/messages/:userId', auth, async (req, res) => {
  const conv = await Conversation.findOne({
    participants: { $all: [req.user.id, req.params.userId] }
  }).populate('messages.sender', 'name username');
  res.json(conv ? conv.messages : []);
});

app.post('/api/block/:userId', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user.blockedUsers.includes(req.params.userId)) {
    user.blockedUsers.push(req.params.userId);
    await user.save();
  }
  res.json({ message: 'User blocked' });
});

app.post('/api/unblock/:userId', auth, async (req, res) => {
  await User.findByIdAndUpdate(req.user.id, { $pull: { blockedUsers: req.params.userId } });
  res.json({ message: 'Unblocked' });
});

app.delete('/api/clear/:userId', auth, async (req, res) => {
  await Conversation.deleteOne({ participants: { $all: [req.user.id, req.params.userId] } });
  res.json({ message: 'Chat cleared' });
});

app.post('/api/messages/send', auth, async (req, res) => {
  try {
    const { to, content, repliedTo } = req.body;
    if (!to || !content) return res.status(400).json({ message: 'Recipient and content required' });

    const recipient = await User.findById(to);
    if (!recipient) return res.status(404).json({ message: 'Recipient not found' });
    if (recipient.blockedUsers.includes(req.user.id)) {
      return res.status(403).json({ message: 'You are blocked by this user' });
    }

    let conv = await Conversation.findOne({ participants: { $all: [req.user.id, to] } });
    if (!conv) {
      conv = new Conversation({ participants: [req.user.id, to] });
    }

    const msg = { sender: req.user.id, content, repliedTo: repliedTo || null, createdAt: new Date() };
    conv.messages.push(msg);
    await conv.save();

    // Populate sender for response
    const updatedConv = await Conversation.findById(conv._id).populate('messages.sender', 'name username');
    const newMessage = updatedConv.messages[updatedConv.messages.length - 1];
    res.json({ message: newMessage, conversationId: conv._id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to send' });
  }
});

app.post('/api/messages/react', auth, async (req, res) => {
  try {
    const { conversationId, messageId, emoji } = req.body;
    const conv = await Conversation.findById(conversationId);
    if (!conv) return res.status(404).json({ message: 'Conversation not found' });
    const msg = conv.messages.id(messageId);
    if (!msg) return res.status(404).json({ message: 'Message not found' });
    // remove existing reaction by same user
    msg.reactions = msg.reactions.filter(r => r.user.toString() !== req.user.id);
    msg.reactions.push({ user: req.user.id, emoji });
    await conv.save();
    res.json({ reactions: msg.reactions });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Reaction failed' });
  }
});

// Fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

module.exports = app;
