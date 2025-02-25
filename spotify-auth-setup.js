import open from 'open';
import express from 'express';
import axios from 'axios';

const app = express();
const PORT = 3000;
const CLIENT_ID = 'YOUR_CLIENT_ID'; // Replace with your actual client ID
const CLIENT_SECRET = 'YOUR_CLIENT_SECRET'; // Replace with your actual client secret

app.get('/callback', async (req, res) => {
  try {
    const code = req.query.code;
    const response = await axios.post('https://accounts.spotify.com/api/token', 
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://localhost:3000/callback',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    console.log('Refresh Token:', response.data.refresh_token);
    res.send('Authentication successful! Check your terminal for the refresh token.');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.response.data);
    res.status(500).send('Authentication failed');
    process.exit(1);
  }
});

app.listen(PORT, async () => {
  const scopes = 'user-read-private user-read-email user-library-read playlist-modify-public';
  const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${CLIENT_ID}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent('http://localhost:3000/callback')}`;
  await open(authUrl);
  console.log(`Server running on http://localhost:${PORT}`);
});
