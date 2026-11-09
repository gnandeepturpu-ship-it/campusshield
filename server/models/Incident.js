
import mongoose from 'mongoose';

const incidentSchema = new mongoose.Schema({

  title: {
    type: String,
    required: true,
    trim: true,
    minlength: 4,
    maxlength: 100
  },

  description: {
    type: String,
    required: true,
    trim: true,
    minlength: 10,
    maxlength: 2000
  },

  category: {
    type: String,
    required: true,
    enum: [
      'Phishing',
      'Suspicious Website',
      'Unauthorized Access',
      'Malware',
      'Network Issue',
      'Other'
    ]
  },

  severity: {
    type: String,
    required: true,
    enum: ['Low', 'Medium', 'High'],
    default: 'Medium'
  },

  status: {
    type: String,
    enum: ['Pending', 'Investigating', 'Resolved'],
    default: 'Pending'
  },

  suspiciousUrl: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ''
  },

  isAnonymous: {
    type: Boolean,
    default: false
  },

  reporter: {
    type: String,
    trim: true,
    maxlength: 80,
    default: 'Anonymous'
  },

  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }

}, {
  timestamps: true
});

export default mongoose.model('Incident', incidentSchema);
