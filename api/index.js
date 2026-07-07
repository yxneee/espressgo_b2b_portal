require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// standard middleware
app.use(cors({
  origin: '*',
  methods: ['POST', 'GET', 'OPTIONS'],
  credentials: true
}));
app.use(express.json());

// Import serverless functions
const createCheckoutSession = require('./create-checkout-session.js');
const chat = require('./chat.js');

// Routes mapping
app.post('/api/create-checkout-session', (req, res) => createCheckoutSession(req, res));
app.post('/create-checkout-session', (req, res) => createCheckoutSession(req, res));

app.post('/api/chat', (req, res) => chat(req, res));
app.post('/chat', (req, res) => chat(req, res));

// Basic check routes
app.get('/', (req, res) => res.send('API Server is Online'));
app.get('/api', (req, res) => res.send('API Server is Online'));

// Local listener
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
