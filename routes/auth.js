const express = require('express');
const router = express.Router();
const { Admin, Chef, Student } = require('../models');

// Small helper so every login route returns a consistent shape
function loginHandler(Model, idField = 'username') {
  return async (req, res) => {
    try {
      const username = (req.body.username || '').trim();
      const password = (req.body.password || '').trim();

      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
      }

      const query = idField === 'email'
        ? { email: username.toLowerCase(), password }
        : { username, password };

      const match = await Model.findOne(query);

      if (!match) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      res.status(200).json({
        message: 'Login successful.',
        user: {
          id: match._id,
          username: match.username,
          email: match.email || undefined
        }
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Server error. Please try again.' });
    }
  };
}

router.post('/admin/login', loginHandler(Admin));
router.post('/chef/login', loginHandler(Chef));
router.post('/student/login', loginHandler(Student, 'email'));
router.post('/student/register', async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = (req.body.password || '').trim();

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are all required.' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    }

    const existing = await Student.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const student = new Student({ username, email, password });
    await student.save();
    res.status(201).json({ message: 'Registration successful.' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

module.exports = router;
