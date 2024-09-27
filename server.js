require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');

// Initialize Express app
const app = express();

// Set the view engine to EJS
app.set('view engine', 'ejs');
app.use(express.static('public'));

// Body parser to parse form data
app.use(bodyParser.urlencoded({ extended: false }));

// Express session setup
app.use(session({
  secret: 'your-session-secret',
  resave: false,
  saveUninitialized: true,
}));

// Initialize Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// MySQL connection pool
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Test the connection
const setupDatabase = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('Database connected successfully');
    connection.release();
  } catch (error) {
    console.error('Error connecting to the database:', error);
  }
};

setupDatabase();

// Passport serialization and deserialization
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Google OAuth strategy for signup and login
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: '/auth/google/callback',
}, async (accessToken, refreshToken, profile, done) => {
  const email = profile.emails[0].value;
  const name = profile.displayName;

  try {
    // Check if the user exists in the database
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);

    if (rows.length > 0) {
      // User exists, proceed with login
      return done(null, rows[0]);
    } else {
      // If the user doesn't exist, create a new entry for Google login
      await pool.query('INSERT INTO users (name, email, google_id) VALUES (?, ?, ?)', [name, email, profile.id]);
      const [newUser] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
      return done(null, newUser[0]);
    }
  } catch (error) {
    return done(error, null);
  }
}));

// Middleware to check user authentication
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/');
}

// Middleware to check user's subscription and email quota
async function checkSubscription(req, res, next) {
  const userId = req.user.id;
  try {
    const [results] = await pool.query('SELECT email_quota FROM subscriptions WHERE user_id = ?', [userId]);
    if (results.length > 0 && results[0].email_quota > 0) {
      req.user.email_quota = results[0].email_quota;
      return next();
    } else {
      res.send('You have reached your email quota. Please purchase more emails.');
    }
  } catch (error) {
    console.error('Error checking subscription:', error);
    res.send('Error checking subscription.');
  }
}

// Landing Page (Login)
app.get('/', (req, res) => {
  res.render('login');
});

// Google Signup/Login
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/dashboard');
  }
);

// Signup Route - Render Signup Page
app.get('/signup', (req, res) => {
  res.render('signup');
});

// Handle Signup Form Submission for manual signup
app.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    // Hash the password before saving
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user into the database
    const [result] = await pool.query('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [name, email, hashedPassword]);

    if (result.affectedRows === 1) {
      res.redirect('/');
    } else {
      res.send('Error creating account');
    }
  } catch (error) {
    console.error('Error during signup:', error);
    res.send('Error during signup');
  }
});

// Dashboard Route
app.get('/dashboard', ensureAuthenticated, async (req, res) => {
  const userId = req.user.id;

  try {
    const [subscription] = await pool.query('SELECT email_quota FROM subscriptions WHERE user_id = ?', [userId]);
    const emailQuota = subscription.length > 0 ? subscription[0].email_quota : 0;

    res.render('dashboard', { user: req.user, emailQuota });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.send('Error loading dashboard.');
  }
});

// Email Sending Route with Subscription Check
app.post('/send-email', ensureAuthenticated, checkSubscription, async (req, res) => {
  const { to, subject, text } = req.body;
  const userId = req.user.id;

  try {
    const tokens = req.user;
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: req.user.emails[0].value,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
      },
    });

    // Send email
    await transporter.sendMail({
      from: req.user.emails[0].value,
      to: to,
      subject: subject,
      text: text,
    });

    // Decrease email quota after sending
    await pool.query('UPDATE subscriptions SET email_quota = email_quota - 1 WHERE user_id = ?', [userId]);
    await pool.query('UPDATE email_usage SET emails_sent = emails_sent + 1 WHERE user_id = ?', [userId]);

    res.send('Email sent successfully');
  } catch (error) {
    console.error('Error sending email:', error);
    res.send('Error sending email: ' + error.message);
  }
});

// Subscription Purchase Route
app.post('/purchase-subscription', ensureAuthenticated, async (req, res) => {
  const { email_quota, amount_paid } = req.body;
  const userId = req.user.id;

  try {
    await pool.query('INSERT INTO subscriptions (user_id, email_quota, amount_paid) VALUES (?, ?, ?)', [userId, email_quota, amount_paid]);
    res.send('Subscription purchased successfully');
  } catch (error) {
    console.error('Error processing subscription:', error);
    res.send('Error processing subscription: ' + error.message);
  }
});

// Subscription Page Route
app.get('/subscription', ensureAuthenticated, (req, res) => {
  res.render('subscription');
});

// Logout Route
app.get('/logout', (req, res) => {
  req.logout(err => {
    if (err) {
      console.log(err);
    }
    res.redirect('/');
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
