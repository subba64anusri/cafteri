const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { Manager, Chef, Student } = require('../models');

// ---------------------------------------------------------------------------
// POST /api/manager/login
// Managers are global — no canteen selection happens at login. The frontend
// stores the returned username in localStorage and sends it back as
// x-manager-username on every subsequent manager request.
// ---------------------------------------------------------------------------
router.post('/manager/login', async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const password = (req.body.password || '').trim();

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const manager = await Manager.findOne({ username });
    if (!manager) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const match = await bcrypt.compare(password, manager.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    res.status(200).json({
      message: 'Login successful.',
      user: {
        id: manager._id,
        username: manager.username,
        fullName: manager.fullName,
        role: 'manager'
      }
    });
  } catch (err) {
    console.error('Manager login error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/chef/login
// A chef's canteen assignment is looked up server-side — the chef never
// chooses or sees other canteens. The response includes canteen info so the
// frontend can immediately scope every following request to it.
// ---------------------------------------------------------------------------
router.post('/chef/login', async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const password = (req.body.password || '').trim();

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const chef = await Chef.findOne({ username }).populate('canteen');
    if (!chef || chef.password !== password) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    if (!chef.isActive) {
      return res.status(403).json({ error: 'This account has been disabled. Contact your manager.' });
    }
    if (!chef.canteen) {
      return res.status(409).json({ error: 'This chef is not assigned to any canteen yet. Contact your manager.' });
    }

    res.status(200).json({
      message: 'Login successful.',
      user: {
        id: chef._id,
        username: chef.username,
        fullName: chef.fullName,
        role: 'chef'
      },
      canteen: {
        id: chef.canteen._id,
        name: chef.canteen.name,
        slug: chef.canteen.slug
      }
    });
  } catch (err) {
    console.error('Chef login error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/student/login
// Customer accounts remain global — canteen choice is a separate, per-visit
// frontend concern (see /api/canteens), not part of the account itself.
// ---------------------------------------------------------------------------
router.post('/student/login', async (req, res) => {
  try {
    const email = (req.body.username || req.body.email || '').trim().toLowerCase();
    const password = (req.body.password || '').trim();

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const student = await Student.findOne({ email });
    if (!student || student.password !== password) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    res.status(200).json({
      message: 'Login successful.',
      user: {
        id: student._id,
        username: student.username,
        email: student.email,
        role: 'student'
      }
    });
  } catch (err) {
    console.error('Student login error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/student/register
// ---------------------------------------------------------------------------
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
    return res.status(201).json({ message: 'Registration successful.' });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

module.exports = router;
