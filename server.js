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

// Google OAuth strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: '/auth/google/callback',
}, (accessToken, refreshToken, profile, done) => {
  // Use profile information to check for user in DB
  return done(null, profile);
}));

// Routes
// Landing Page
app.get('/', (req, res) => {
  res.render('login'); // Render login.ejs for the landing page
});


// Google Login
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/dashboard'); // Redirect to dashboard after successful login
  }
);

// Dashboard
app.get('/dashboard', ensureAuthenticated, (req, res) => {
  res.render('dashboard', { user: req.user });
});

// Email Sending Route
app.post('/send-email', ensureAuthenticated, async (req, res) => {
  const { to, subject, text } = req.body;
  const oauth2Client = new (require('google-auth-library')).OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  );

  try {
    const tokens = req.user; // You should store the access token after Google login
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
    let info = await transporter.sendMail({
      from: req.user.emails[0].value,
      to: to,
      subject: subject,
      text: text,
    });

    console.log('Message sent: %s', info.messageId);
    res.send('Email sent successfully');
  } catch (error) {
    console.error('Error sending email:', error);
    res.send('Error sending email: ' + error.message);
  }
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

// Middleware to check if the user is authenticated
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/');
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

