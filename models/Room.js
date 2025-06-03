const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  name: { type: String, unique: true, required: true },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: String, required: true },
});

module.exports = mongoose.model('Room', roomSchema);
