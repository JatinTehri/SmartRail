const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// ---------------------------------------------------------------------------
// Core middleware
// ---------------------------------------------------------------------------

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

app.use('/api', routes);

// ---------------------------------------------------------------------------
// 404 handler — catch requests that match no route
// ---------------------------------------------------------------------------

app.use((req, res, next) => {
  const AppError = require('./errors/AppError');
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404, 'ROUTE_NOT_FOUND'));
});

// ---------------------------------------------------------------------------
// Centralized error handler (must be registered last)
// ---------------------------------------------------------------------------

app.use(errorHandler);

module.exports = app;
