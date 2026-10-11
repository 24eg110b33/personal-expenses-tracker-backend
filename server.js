const express = require('express');
const cors = require('cors');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'transactions.json');
const ALLOWED_TYPES = new Set(['income', 'expense']);
const CATEGORIES = new Set(['Food', 'Travel', 'Shopping', 'Education', 'Bills', 'Entertainment', 'Health', 'Other']);

app.use(cors({
  origin: (origin, callback) => callback(null, true),
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '100kb' }));

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, '[]\n', 'utf8');
  }
}

async function readTransactions() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Transaction storage must contain a JSON array.');
  return parsed;
}

async function writeTransactions(transactions) {
  await ensureDataFile();
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(transactions, null, 2)}\n`, 'utf8');
  await fs.rename(tempFile, DATA_FILE);
}

function validateTransaction(body) {
  const errors = [];
  const type = String(body.type || '').toLowerCase();
  const amount = Number(body.amount);
  const date = String(body.date || '');
  const category = String(body.category || '');
  const description = String(body.description || '').trim();

  if (!ALLOWED_TYPES.has(type)) errors.push('Type must be income or expense.');
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) errors.push('Amount must be a number greater than 0 and no more than 1,000,000,000.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) errors.push('Date must be a valid date in YYYY-MM-DD format.');
  if (!CATEGORIES.has(category)) errors.push('Choose a valid category.');
  if (description.length > 120) errors.push('Description must be 120 characters or fewer.');

  return { errors, value: { type, amount: Math.round(amount * 100) / 100, date, category, description } };
}

app.get('/api/health', async (req, res) => {
  try {
    await ensureDataFile();
    res.json({ status: 'ok', message: 'Personal Expense Tracker API is running.', storage: 'json-file', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ status: 'error', error: 'Storage is unavailable.' });
  }
});

app.get('/api/transactions', async (req, res, next) => {
  try {
    const transactions = await readTransactions();
    transactions.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    res.json({ transactions });
  } catch (error) {
    next(error);
  }
});

app.post('/api/transactions', async (req, res, next) => {
  try {
    const { errors, value } = validateTransaction(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    const transactions = await readTransactions();
    const transaction = {
      id: crypto.randomUUID(),
      ...value,
      createdAt: new Date().toISOString()
    };
    transactions.push(transaction);
    await writeTransactions(transactions);
    return res.status(201).json({ message: 'Transaction created.', transaction });
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/transactions/:id', async (req, res, next) => {
  try {
    const transactions = await readTransactions();
    const remaining = transactions.filter((item) => item.id !== req.params.id);
    if (remaining.length === transactions.length) return res.status(404).json({ error: 'Transaction not found.' });
    await writeTransactions(remaining);
    return res.json({ message: 'Transaction deleted.', id: req.params.id });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/summary', async (req, res, next) => {
  try {
    const transactions = await readTransactions();
    const income = transactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + Number(item.amount), 0);
    const expenses = transactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount), 0);
    const round = (number) => Math.round((number + Number.EPSILON) * 100) / 100;
    res.json({
      income: round(income),
      expenses: round(expenses),
      balance: round(income - expenses),
      transactionCount: transactions.length
    });
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found. Check the API endpoint.' });
});

app.use((error, req, res, next) => {
  console.error('API error:', error.message);
  if (res.headersSent) return next(error);
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ error: 'Invalid JSON request body.' });
  }
  return res.status(500).json({ error: 'Internal server error. Please try again.' });
});

ensureDataFile()
  .then(() => app.listen(PORT, '0.0.0.0', () => {
    console.log(`Personal Expense Tracker API running at http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
    console.log(`JSON storage: ${DATA_FILE}`);
  }))
  .catch((error) => {
    console.error('Could not initialize JSON storage:', error);
    process.exit(1);
  });
