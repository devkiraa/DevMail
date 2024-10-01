const express = require('express');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const OAuth2 = google.auth.OAuth2;
const router = express.Router();

// Endpoint to send email using OAuth2 tokens
router.post('/send', async (req, res) => {
  const { to, subject, text, accessToken, refreshToken } = req.body;

  // Validate the request body
  if (!to || !subject || !text || !accessToken || !refreshToken) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Create an OAuth2 client
    const oauth2Client = new OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground' // This can be changed to your actual redirect URI
    );

    // Set the access and refresh tokens
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    // Generate the access token again if needed
    const newAccessToken = await oauth2Client.getAccessToken();

    // Create a Nodemailer transporter using OAuth2
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.EMAIL_USER, // Use the user's email here
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: refreshToken,
        accessToken: newAccessToken.token,
      },
    });

    // Mail options
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: to,
      subject: subject,
      text: text,
    };

    // Send the email
    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: 'Email sent successfully using OAuth2' });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

module.exports = router;
