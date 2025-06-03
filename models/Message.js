const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  room: { type: String, required: true },
  user: { type: String, required: true },
  avatar: { type: String },
  text: { type: String, required: true },
  time: { type: Date, default: Date.now },
  seenBy: { type: [String], default: [] },
});

module.exports = mongoose.model('Message', messageSchema);
