// Import required modules and routes
const express = require('express');
const bodyParser = require('body-parser');
const mailRoutes = require('./routes/mail');
const axios = require('axios');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
require('dotenv').config(); // Load environment variables

// Initialize Express app
const app = express();

// Middleware to parse incoming request bodies and handle sessions
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'your-secret-key', resave: false, saveUninitialized: true }));

// Initialize Passport middleware for authentication
app.use(passport.initialize());
app.use(passport.session());

// Define and configure Google OAuth strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: '/auth/google/callback',
  passReqToCallback: true,
}, async (req, accessToken, refreshToken, profile, done) => {
  try {
    // Store access and refresh tokens in session or database
    req.session.accessToken = accessToken;
    req.session.refreshToken = refreshToken;

    // Save tokens in your database if required (example query)
    await pool.query(
      'INSERT INTO users (google_id, name, email, access_token, refresh_token) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE access_token = ?, refresh_token = ?',
      [profile.id, profile.displayName, profile.emails[0].value, accessToken, refreshToken, accessToken, refreshToken]
    );

    return done(null, profile);
  } catch (error) {
    return done(error);
  }
}));

// Serialize and deserialize user for session handling
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Middleware to ensure user is authenticated
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login'); // Redirect to login page if not authenticated
}

// Middleware to check if the user has an active subscription
function checkSubscription(req, res, next) {
  // Placeholder for subscription check logic
  // Assuming 'subscriptions' is a table and 'email_quota' is a column in it
  pool.query('SELECT email_quota FROM subscriptions WHERE user_id = ?', [req.user.id], (err, result) => {
    if (err) return res.status(500).send('Error checking subscription');
    if (result[0].email_quota > 0) return next(); // Proceed if quota is available
    return res.status(403).send('Email quota exceeded. Please upgrade your plan.');
  });
}

// Main route for sending email
app.post('/send-email', ensureAuthenticated, checkSubscription, async (req, res) => {
  const { to, subject, text } = req.body;

  try {
    // Retrieve tokens from session
    const accessToken = req.session.accessToken;
    const refreshToken = req.session.refreshToken;

    // Send email through mail server using axios
    const response = await axios.post('http://localhost:3001/api/mail/send', {
      to,
      subject,
      text,
      accessToken,
      refreshToken,
    });

    if (response.status === 200) {
      // Decrease email quota after sending
      await pool.query('UPDATE subscriptions SET email_quota = email_quota - 1 WHERE user_id = ?', [req.user.id]);
      await pool.query('UPDATE email_usage SET emails_sent = emails_sent + 1 WHERE user_id = ?', [req.user.id]);

      res.send('Email sent successfully');
    }
  } catch (error) {
    console.error('Error sending email:', error);
    res.send('Error sending email: ' + error.message);
  }
});

// Define routes for mail server
app.use('/api/mail', mailRoutes);

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Mail server is running on http://localhost:${PORT}`);
});
