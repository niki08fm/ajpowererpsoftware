'use strict';
const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();
app.use(cors());                       // wide open on purpose while building
app.use(express.json({ limit: '4mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));
app.use('/api', require('./routes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
