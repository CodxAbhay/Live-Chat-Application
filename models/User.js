const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  avatar: { type: String },
});

userSchema.methods.verify = function (pwd) {
  return this.password === pwd;
};

module.exports = mongoose.model('User', userSchema);
