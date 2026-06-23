// Simple, no-JWT auth layer. The frontend stores an identifier in
// localStorage after login (manager username, chef username, or student
// email) and re-sends it on every request as a header. This middleware
// re-validates that identifier against the database on every request — it
// is NOT a signed token, so it's only as strong as "don't expose these
// headers to untrusted code", which matches the original app's security
// posture (a localStorage string) while closing the gap where ANY string
// was accepted with no DB check at all.
//
// Headers used:
//   x-manager-username  — manager portal
//   x-chef-username      — chef portal
//   x-student-email       — customer portal

const { Manager, Chef, Student, Canteen } = require('../models');

// Attaches req.manager if the header corresponds to a real, existing manager.
// Responds 401 if missing/invalid.
async function requireManager(req, res, next) {
  try {
    const username = req.header('x-manager-username');
    if (!username) {
      return res.status(401).json({ error: 'Manager session required.' });
    }
    const manager = await Manager.findOne({ username });
    if (!manager) {
      return res.status(401).json({ error: 'Invalid manager session. Please log in again.' });
    }
    req.manager = manager;
    next();
  } catch (err) {
    console.error('requireManager error:', err);
    res.status(500).json({ error: 'Authorization check failed.' });
  }
}

// Attaches req.chef (with .canteen populated) if the header corresponds to a
// real, active chef. Responds 401/403 appropriately.
async function requireChef(req, res, next) {
  try {
    const username = req.header('x-chef-username');
    if (!username) {
      return res.status(401).json({ error: 'Chef session required.' });
    }
    const chef = await Chef.findOne({ username }).populate('canteen');
    if (!chef) {
      return res.status(401).json({ error: 'Invalid chef session. Please log in again.' });
    }
    if (!chef.isActive) {
      return res.status(403).json({ error: 'This chef account has been disabled.' });
    }
    if (!chef.canteen || !chef.canteen.isActive) {
      return res.status(403).json({ error: 'Your assigned canteen is not currently active.' });
    }
    req.chef = chef;
    next();
  } catch (err) {
    console.error('requireChef error:', err);
    res.status(500).json({ error: 'Authorization check failed.' });
  }
}

// Attaches req.student if the header corresponds to a real student/customer.
async function requireStudent(req, res, next) {
  try {
    const email = (req.header('x-student-email') || '').toLowerCase().trim();
    if (!email) {
      return res.status(401).json({ error: 'Customer session required.' });
    }
    const student = await Student.findOne({ email });
    if (!student) {
      return res.status(401).json({ error: 'Invalid session. Please log in again.' });
    }
    req.student = student;
    next();
  } catch (err) {
    console.error('requireStudent error:', err);
    res.status(500).json({ error: 'Authorization check failed.' });
  }
}

// Resolves :canteenId (or ?canteenId=) from the request, verifies it exists
// and is active, and attaches it as req.canteen. Used by every customer- and
// chef-facing route that needs to know which canteen's data to touch.
// `requireActive` defaults to true for customer-facing routes; managers can
// pass false to view/manage a disabled canteen.
function loadCanteen({ requireActive = true } = {}) {
  return async (req, res, next) => {
    try {
      const canteenId = req.params.canteenId || req.query.canteenId || req.body.canteenId;
      if (!canteenId) {
        return res.status(400).json({ error: 'canteenId is required.' });
      }
      const canteen = await Canteen.findById(canteenId);
      if (!canteen) {
        return res.status(404).json({ error: 'Canteen not found.' });
      }
      if (requireActive && !canteen.isActive) {
        return res.status(403).json({ error: 'This canteen is currently unavailable.' });
      }
      req.canteen = canteen;
      next();
    } catch (err) {
      console.error('loadCanteen error:', err);
      res.status(400).json({ error: 'Invalid canteen reference.' });
    }
  };
}

module.exports = { requireManager, requireChef, requireStudent, loadCanteen };
