
import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import Incident from './models/Incident.js';
import User from './models/User.js';

const app = express();
const PORT = process.env.PORT || 5001;

// ==========================================
// 1. ENVIRONMENT VALIDATION
// ==========================================

if (!process.env.MONGODB_URI) {
  console.error('Missing MONGODB_URI in server/.env');
  process.exit(1);
}

if (!process.env.JWT_SECRET) {
  console.error('Missing JWT_SECRET in server/.env');
  process.exit(1);
}

// ==========================================
// 2. SECURITY MIDDLEWARE
// ==========================================

app.use(helmet());

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173'
}));

app.use(express.json({ limit: '20kb' }));

app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 150,
  standardHeaders: true,
  legacyHeaders: false
}));

// ==========================================
// 3. JWT AUTHENTICATION
// ==========================================

async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({
      message: 'Authentication required.'
    });
  }

  try {
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.sub)
      .select('_id name email role');

    if (!user) {
      return res.status(401).json({
        message: 'User account not found.'
      });
    }

    req.user = user;
    next();

  } catch (error) {
    return res.status(401).json({
      message: 'Invalid or expired token.'
    });
  }
}

// ==========================================
// 4. ROLE AUTHORIZATION
// ==========================================

function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: 'You do not have permission to perform this action.'
      });
    }

    next();
  };
}

// ==========================================
// 5. HEALTH CHECK
// ==========================================

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'CampusShield API'
  });
});

// ==========================================
// 6. USER REGISTRATION
// ==========================================

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (
      typeof name !== 'string' ||
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      !name.trim() ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        message: 'Name, email and password are required.'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: 'Password must contain at least 8 characters.'
      });
    }

    if (name.trim().length > 80) {
      return res.status(400).json({
        message: 'Name cannot exceed 80 characters.'
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await User.findOne({
      email: normalizedEmail
    });

    if (existingUser) {
      return res.status(409).json({
        message: 'Email is already registered.'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: 'student'
    });

    const token = jwt.sign(
      { sub: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.status(201).json({
      message: 'Registration successful.',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: 'Email is already registered.'
      });
    }

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        message: error.message
      });
    }

    next(error);
  }
});

// ==========================================
// 7. USER LOGIN
// ==========================================

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        message: 'Email and password are required.'
      });
    }

    const user = await User.findOne({
      email: email.trim().toLowerCase()
    }).select('+password');

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({
        message: 'Invalid email or password.'
      });
    }

    const token = jwt.sign(
      { sub: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      message: 'Login successful.',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    next(error);
  }
});

// ==========================================
// 8. AUTHENTICATED USER PROFILE
// ==========================================

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role
    }
  });
});

// ==========================================
// 9. GET ALL INCIDENTS
// All logged-in users can view incidents.
// ==========================================

app.get('/api/incidents', authenticateToken, async (req, res, next) => {
  try {
    const { status, category } = req.query;
    const filter = {};

    if (status) {
      if (!['Pending', 'Investigating', 'Resolved'].includes(status)) {
        return res.status(400).json({
          message: 'Invalid status filter.'
        });
      }

      filter.status = status;
    }

    if (category) {
      filter.category = category;
    }

    const incidents = await Incident.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.json(incidents);

  } catch (error) {
    next(error);
  }
});

// ==========================================
// 10. SUBMIT INCIDENT
// All logged-in users can submit.
// ==========================================

app.post('/api/incidents', authenticateToken, async (req, res, next) => {
  try {
    const {
      title,
      description,
      category,
      severity,
      suspiciousUrl,
      isAnonymous
    } = req.body;

    if (
      typeof title !== 'string' ||
      typeof description !== 'string' ||
      typeof category !== 'string' ||
      !title.trim() ||
      !description.trim()
    ) {
      return res.status(400).json({
        message: 'Title, description and category are required.'
      });
    }

    if (
      severity !== undefined &&
      !['Low', 'Medium', 'High'].includes(severity)
    ) {
      return res.status(400).json({
        message: 'Invalid severity.'
      });
    }

    if (
      isAnonymous !== undefined &&
      typeof isAnonymous !== 'boolean'
    ) {
      return res.status(400).json({
        message: 'isAnonymous must be true or false.'
      });
    }

    let normalizedUrl = '';

    if (suspiciousUrl) {
      if (
        typeof suspiciousUrl !== 'string' ||
        suspiciousUrl.length > 500
      ) {
        return res.status(400).json({
          message: 'Invalid suspicious URL.'
        });
      }

      try {
        const parsedUrl = new URL(suspiciousUrl);

        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          throw new Error('Unsupported protocol');
        }

        normalizedUrl = parsedUrl.href;

      } catch {
        return res.status(400).json({
          message: 'Enter a valid HTTP or HTTPS URL.'
        });
      }
    }

    const anonymous = isAnonymous === true;

    const incident = await Incident.create({
      title: title.trim(),
      description: description.trim(),
      category,
      severity: severity || 'Medium',
      suspiciousUrl: normalizedUrl,
      isAnonymous: anonymous,
      reporter: anonymous ? 'Anonymous' : req.user.name,
      submittedBy: req.user._id
    });

    res.status(201).json(incident);

  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        message: error.message
      });
    }

    next(error);
  }
});

// ==========================================
// 11. UPDATE INCIDENT STATUS
// Security and Admin only.
// ==========================================

app.patch(
  '/api/incidents/:id/status',
  authenticateToken,
  authorizeRoles('security', 'admin'),
  async (req, res, next) => {
    try {
      const { status } = req.body;

      if (!['Pending', 'Investigating', 'Resolved'].includes(status)) {
        return res.status(400).json({
          message: 'Invalid status.'
        });
      }

      const incident = await Incident.findByIdAndUpdate(
        req.params.id,
        { $set: { status } },
        {
          new: true,
          runValidators: true
        }
      );

      if (!incident) {
        return res.status(404).json({
          message: 'Incident not found.'
        });
      }

      res.json(incident);

    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// 12. DELETE INCIDENT
// Admin only.
// ==========================================

app.delete(
  '/api/incidents/:id',
  authenticateToken,
  authorizeRoles('admin'),
  async (req, res, next) => {
    try {
      const incident = await Incident.findByIdAndDelete(req.params.id);

      if (!incident) {
        return res.status(404).json({
          message: 'Incident not found.'
        });
      }

      res.json({
        message: 'Incident deleted.'
      });

    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// 13. GLOBAL ERROR HANDLER
// ==========================================

app.use((error, _req, res, _next) => {
  console.error(error);

  if (error.name === 'CastError') {
    return res.status(400).json({
      message: 'Invalid incident ID.'
    });
  }

  if (error.name === 'ValidationError') {
    return res.status(400).json({
      message: error.message
    });
  }

  res.status(500).json({
    message: 'Something went wrong on the server.'
  });
});

// ==========================================
// 14. CONNECT TO MONGODB
// ==========================================

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected successfully.');

    app.listen(PORT, () => {
      console.log(
        `CampusShield API running at http://localhost:${PORT}`
      );
    });
  })
  .catch((error) => {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  });
