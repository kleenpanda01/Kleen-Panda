const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const { Pool } = require('pg');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'kleen-panda-secret-2024';

// Check if DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error('WARNING: DATABASE_URL environment variable is not set!');
  console.error('The app will not work correctly without a database connection.');
}

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

pool.on('connect', () => {
  console.log('Database connected successfully');
});

// Initialize database tables
async function initDB() {
  console.log('Initializing database...');
  console.log('DATABASE_URL set:', !!process.env.DATABASE_URL);
  
  let client;
  try {
    client = await pool.connect();
    console.log('Connected to database, creating tables...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'staff',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        email VARCHAR(255),
        address TEXT,
        password VARCHAR(255),
        discount DECIMAL(5,2) DEFAULT 0,
        sms_consent BOOLEAN DEFAULT FALSE,
        payment_methods JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        price DECIMAL(10,2) NOT NULL,
        unit VARCHAR(50) DEFAULT 'item',
        description TEXT,
        active INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 99
      );
      
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_number VARCHAR(50) UNIQUE,
        customer_id INTEGER REFERENCES customers(id),
        customer_name VARCHAR(255),
        customer_phone VARCHAR(50),
        customer_email VARCHAR(255),
        customer_address TEXT,
        order_type VARCHAR(50) DEFAULT 'counter',
        items JSONB DEFAULT '[]',
        subtotal DECIMAL(10,2) DEFAULT 0,
        tax DECIMAL(10,2) DEFAULT 0,
        discount DECIMAL(5,2) DEFAULT 0,
        adjustment DECIMAL(10,2) DEFAULT 0,
        total DECIMAL(10,2) DEFAULT 0,
        weight DECIMAL(10,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'received',
        payment_method VARCHAR(50),
        payment_status VARCHAR(50) DEFAULT 'unpaid',
        notes TEXT,
        created_by INTEGER,
        created_by_name VARCHAR(255),
        delivery_photo TEXT,
        delivered_at TIMESTAMP,
        delivered_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS time_entries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        user_name VARCHAR(255),
        clock_in TIMESTAMP,
        clock_out TIMESTAMP,
        hours_worked DECIMAL(10,2),
        date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS cash_drawer (
        id SERIAL PRIMARY KEY,
        type VARCHAR(50),
        hundreds INTEGER DEFAULT 0,
        fifties INTEGER DEFAULT 0,
        twenties INTEGER DEFAULT 0,
        tens INTEGER DEFAULT 0,
        fives INTEGER DEFAULT 0,
        ones INTEGER DEFAULT 0,
        change DECIMAL(10,2) DEFAULT 0,
        total DECIMAL(10,2) DEFAULT 0,
        amount DECIMAL(10,2) DEFAULT 0,
        description TEXT,
        notes TEXT,
        user_id INTEGER,
        user_name VARCHAR(255),
        date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT
      );
    `);
    
    // Check if admin user exists
    const adminCheck = await client.query("SELECT id FROM users WHERE username = 'admin'");
    if (adminCheck.rows.length === 0) {
      await client.query(`
        INSERT INTO users (username, password, name, role) VALUES
        ('admin', 'Laundry123!', 'Admin', 'admin'),
        ('beni', 'staff123', 'Beni', 'staff'),
        ('erika', 'staff123', 'Erika', 'staff'),
        ('clara', 'staff123', 'Clara', 'staff'),
        ('driver', 'driver123', 'Driver', 'driver')
      `);
    }
    
    // Check if services exist
    const servicesCheck = await client.query("SELECT id FROM services LIMIT 1");
    if (servicesCheck.rows.length === 0) {
      await client.query(`
        INSERT INTO services (id, name, category, price, unit, description, active, sort_order) VALUES
        (1, 'Wash & Fold - Regular', 'Wash & Fold', 1.40, 'lb', 'Standard wash and fold', 1, 1),
        (2, 'Wash & Fold - RUSH', 'Wash & Fold', 2.10, 'lb', 'Same-day rush service', 1, 2),
        (21, 'Blanket - Small', 'Wash & Fold', 15.00, 'item', 'Small blanket', 1, 3),
        (22, 'Blanket - Medium', 'Wash & Fold', 20.00, 'item', 'Medium blanket', 1, 4),
        (23, 'Blanket - Large', 'Wash & Fold', 25.00, 'item', 'Large blanket', 1, 5),
        (24, 'Comforter - Small', 'Wash & Fold', 25.00, 'item', 'Small comforter', 1, 6),
        (25, 'Comforter - Medium', 'Wash & Fold', 30.00, 'item', 'Medium comforter', 1, 7),
        (26, 'Comforter - Large', 'Wash & Fold', 40.00, 'item', 'Large comforter', 1, 8),
        (27, 'Pillow', 'Wash & Fold', 10.00, 'item', 'Pillow cleaning', 1, 9),
        (28, 'Rug - Small', 'Wash & Fold', 25.00, 'item', 'Small rug', 1, 10),
        (29, 'Rug - Medium', 'Wash & Fold', 40.00, 'item', 'Medium rug', 1, 11),
        (30, 'Rug - Large', 'Wash & Fold', 60.00, 'item', 'Large rug', 1, 12),
        (3, 'Mens Dress Shirt', 'Dry Cleaning', 5.95, 'item', 'Laundered & pressed', 1, 20),
        (4, 'Pants/Trousers', 'Dry Cleaning', 10.50, 'item', 'Dry cleaned', 1, 21),
        (5, 'Suit (2-piece)', 'Dry Cleaning', 23.10, 'item', 'Jacket and pants', 1, 22),
        (6, 'Suit (3-piece)', 'Dry Cleaning', 30.80, 'item', 'Jacket, pants, vest', 1, 23),
        (7, 'Dress', 'Dry Cleaning', 19.60, 'item', 'Regular dresses', 1, 24),
        (8, 'Sweater', 'Dry Cleaning', 10.50, 'item', 'Knit sweaters', 1, 25),
        (9, 'Coat/Jacket', 'Dry Cleaning', 28.00, 'item', 'Coats and jackets', 1, 26),
        (10, 'Blouse', 'Dry Cleaning', 10.50, 'item', 'Blouses', 1, 27),
        (11, 'Skirt', 'Dry Cleaning', 10.50, 'item', 'Skirts', 1, 28),
        (12, 'Shirt Press', 'Press', 4.20, 'item', 'Press only', 1, 40),
        (13, 'Pants Press', 'Press', 7.00, 'item', 'Press only', 1, 41),
        (14, 'Hem Pants', 'Alterations', 14.00, 'item', 'Hem adjustment', 1, 50),
        (15, 'Zipper Replace', 'Alterations', 21.00, 'item', 'Zipper replacement', 1, 51),
        (16, 'Button Replace', 'Alterations', 3.50, 'item', 'Button replacement', 1, 52)
      `);
    }
    
    // Default settings
    const settingsCheck = await client.query("SELECT key FROM settings LIMIT 1");
    if (settingsCheck.rows.length === 0) {
      await client.query(`
        INSERT INTO settings (key, value) VALUES
        ('business_name', 'Kleen Panda Laundromat'),
        ('address', '113 E Tremont Ave'),
        ('city', 'Bronx'),
        ('state', 'NY'),
        ('zip', '10453'),
        ('phone', '(347) 230-8400'),
        ('email', 'info@kleenpanda.com'),
        ('tax_rate', '8.875'),
        ('delivery_days', 'Monday,Friday'),
        ('pickup_time_start', '17:00'),
        ('pickup_time_end', '21:00')
      `);
    }
    
    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Database initialization error:', err);
    throw err; // Re-throw to prevent app from starting with broken DB
  } finally {
    if (client) client.release();
  }
}

// Helper to get next order number
async function getNextOrderNumber() {
  const result = await pool.query("SELECT COUNT(*) as count FROM orders");
  const count = parseInt(result.rows[0].count) + 1;
  return 'KP' + String(count).padStart(5, '0');
}

// Auth middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
};

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};

// AUTH ROUTES
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );
    const user = result.rows[0];
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, name, role FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SERVICES
app.get('/api/services', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM services ORDER BY sort_order, id');
    const services = result.rows.map(s => ({
      id: s.id, name: s.name, category: s.category, price: parseFloat(s.price),
      unit: s.unit, description: s.description, active: s.active, sortOrder: s.sort_order
    }));
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/services/:id', authMiddleware, async (req, res) => {
  try {
    const { price, active } = req.body;
    if (price !== undefined) {
      await pool.query('UPDATE services SET price = $1 WHERE id = $2', [price, req.params.id]);
    }
    if (active !== undefined) {
      await pool.query('UPDATE services SET active = $1 WHERE id = $2', [active, req.params.id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CUSTOMERS
app.get('/api/customers', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM customers ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/customers', authMiddleware, async (req, res) => {
  try {
    const { name, phone, email, address, discount } = req.body;
    const result = await pool.query(
      'INSERT INTO customers (name, phone, email, address, discount) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, phone, email || '', address || '', discount || 0]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/customers/:id', authMiddleware, async (req, res) => {
  try {
    const { name, phone, email, address, discount } = req.body;
    const result = await pool.query(
      'UPDATE customers SET name = COALESCE($1, name), phone = COALESCE($2, phone), email = COALESCE($3, email), address = COALESCE($4, address), discount = COALESCE($5, discount) WHERE id = $6 RETURNING *',
      [name, phone, email, address, discount, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ORDERS
app.get('/api/orders', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100');
    res.json(result.rows.map(o => ({...o, items: o.items || [], total: parseFloat(o.total), subtotal: parseFloat(o.subtotal), tax: parseFloat(o.tax)})));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', authMiddleware, async (req, res) => {
  try {
    const { customer_id, customer_name, customer_phone, customer_email, customer_address, order_type, items, payment_method, weight, adjustment, discount, notes } = req.body;
    const order_number = await getNextOrderNumber();
    
    const subtotal = items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
    const discountAmount = subtotal * ((discount || 0) / 100);
    const afterDiscount = subtotal - discountAmount + (adjustment || 0);
    const tax = afterDiscount * 0.08875;
    const total = Math.max(0, afterDiscount + tax);
    
    const result = await pool.query(
      `INSERT INTO orders (order_number, customer_id, customer_name, customer_phone, customer_email, customer_address, order_type, items, subtotal, tax, discount, adjustment, total, weight, payment_method, notes, created_by, created_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *`,
      [order_number, customer_id, customer_name, customer_phone, customer_email, customer_address, order_type || 'counter', JSON.stringify(items), subtotal, tax, discount || 0, adjustment || 0, total, weight || 0, payment_method, notes, req.user.id, req.user.name]
    );
    res.json({...result.rows[0], total: parseFloat(result.rows[0].total)});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/orders/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const result = await pool.query(
      'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/orders/:id/payment', authMiddleware, async (req, res) => {
  try {
    const { payment_status, payment_method } = req.body;
    const result = await pool.query(
      'UPDATE orders SET payment_status = $1, payment_method = COALESCE($2, payment_method) WHERE id = $3 RETURNING *',
      [payment_status, payment_method, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders/:id/deliver', authMiddleware, async (req, res) => {
  try {
    const { photo } = req.body;
    await pool.query(
      'UPDATE orders SET status = $1, delivery_photo = $2, delivered_at = NOW(), delivered_by = $3 WHERE id = $4',
      ['delivered', photo, req.user.name, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TIME ENTRIES
app.get('/api/time-entries/status', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM time_entries WHERE user_id = $1 AND clock_out IS NULL',
      [req.user.id]
    );
    res.json({ clockedIn: result.rows.length > 0, entry: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/time-entries/clock-in', authMiddleware, async (req, res) => {
  try {
    const check = await pool.query('SELECT id FROM time_entries WHERE user_id = $1 AND clock_out IS NULL', [req.user.id]);
    if (check.rows.length > 0) return res.status(400).json({ error: 'Already clocked in' });
    
    const result = await pool.query(
      'INSERT INTO time_entries (user_id, user_name, clock_in, date) VALUES ($1, $2, NOW(), CURRENT_DATE) RETURNING *',
      [req.user.id, req.user.name]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/time-entries/clock-out', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE time_entries SET clock_out = NOW(), hours_worked = EXTRACT(EPOCH FROM (NOW() - clock_in))/3600 
       WHERE user_id = $1 AND clock_out IS NULL RETURNING *`,
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(400).json({ error: 'Not clocked in' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CASH DRAWER
app.get('/api/cash-drawer/status', authMiddleware, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const entries = await pool.query('SELECT * FROM cash_drawer WHERE date = $1', [today]);
    const opening = entries.rows.find(e => e.type === 'opening');
    const closing = entries.rows.find(e => e.type === 'closing');
    const expenses = entries.rows.filter(e => e.type === 'expense');
    const expenseTotal = expenses.reduce((sum, e) => sum + parseFloat(e.amount || e.total || 0), 0);
    
    const cashOrders = await pool.query(
      "SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE DATE(created_at) = $1 AND payment_method = 'cash' AND payment_status = 'paid'",
      [today]
    );
    const cashSales = parseFloat(cashOrders.rows[0].total);
    
    const expectedCash = (opening ? parseFloat(opening.total) : 0) + cashSales - expenseTotal;
    const actualCash = closing ? parseFloat(closing.total) : null;
    const mismatch = actualCash !== null ? actualCash - expectedCash : null;
    
    res.json({
      date: today, opening, closing, cashSales, expenses, expenseTotal, expectedCash, actualCash, mismatch,
      hasMismatch: mismatch !== null && Math.abs(mismatch) > 0.01
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cash-drawer', authMiddleware, async (req, res) => {
  try {
    const { type, hundreds, fifties, twenties, tens, fives, ones, change, notes, amount, description } = req.body;
    const today = new Date().toISOString().slice(0, 10);
    
    if (type === 'expense') {
      const result = await pool.query(
        'INSERT INTO cash_drawer (type, amount, total, description, notes, user_id, user_name, date) VALUES ($1, $2, $2, $3, $4, $5, $6, $7) RETURNING *',
        ['expense', amount, description, notes, req.user.id, req.user.name, today]
      );
      return res.json(result.rows[0]);
    }
    
    const total = (hundreds || 0) * 100 + (fifties || 0) * 50 + (twenties || 0) * 20 + (tens || 0) * 10 + (fives || 0) * 5 + (ones || 0) * 1 + (change || 0);
    const result = await pool.query(
      'INSERT INTO cash_drawer (type, hundreds, fifties, twenties, tens, fives, ones, change, total, notes, user_id, user_name, date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *',
      [type, hundreds, fifties, twenties, tens, fives, ones, change, total, notes, req.user.id, req.user.name, today]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// STAFF SUMMARY
app.get('/api/staff-summary', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { start, end } = req.query;
    const startDate = start || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const endDate = end || new Date().toISOString().slice(0, 10);
    
    const timeResult = await pool.query(
      'SELECT user_name, COALESCE(SUM(hours_worked), 0) as hours FROM time_entries WHERE date BETWEEN $1 AND $2 GROUP BY user_name',
      [startDate, endDate]
    );
    
    const ordersResult = await pool.query(
      'SELECT created_by_name, COUNT(*) as orders, COALESCE(SUM(total), 0) as sales, COALESCE(SUM(weight), 0) as weight FROM orders WHERE DATE(created_at) BETWEEN $1 AND $2 GROUP BY created_by_name',
      [startDate, endDate]
    );
    
    const staffMap = {};
    timeResult.rows.forEach(r => {
      staffMap[r.user_name] = { name: r.user_name, hoursWorked: parseFloat(r.hours), sales: 0, weight: 0, ordersProcessed: 0 };
    });
    ordersResult.rows.forEach(r => {
      if (!staffMap[r.created_by_name]) staffMap[r.created_by_name] = { name: r.created_by_name, hoursWorked: 0, sales: 0, weight: 0, ordersProcessed: 0 };
      staffMap[r.created_by_name].sales = parseFloat(r.sales);
      staffMap[r.created_by_name].weight = parseFloat(r.weight);
      staffMap[r.created_by_name].ordersProcessed = parseInt(r.orders);
    });
    
    res.json({ staff: Object.values(staffMap) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REPORTS
app.get('/api/reports', authMiddleware, async (req, res) => {
  try {
    const { period } = req.query;
    let startDate, endDate = new Date();
    
    if (period === 'today') {
      startDate = new Date(); startDate.setHours(0, 0, 0, 0);
    } else if (period === 'this_week') {
      startDate = new Date(); startDate.setDate(startDate.getDate() - 7);
    } else {
      startDate = new Date(); startDate.setMonth(startDate.getMonth() - 1);
    }
    
    const result = await pool.query(
      'SELECT COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue, COALESCE(SUM(weight), 0) as weight FROM orders WHERE created_at BETWEEN $1 AND $2',
      [startDate, endDate]
    );
    
    const topCustomers = await pool.query(
      'SELECT customer_name as name, COUNT(*) as orders, SUM(total) as total FROM orders WHERE created_at BETWEEN $1 AND $2 AND customer_name IS NOT NULL GROUP BY customer_name ORDER BY total DESC LIMIT 10',
      [startDate, endDate]
    );
    
    res.json({
      totalOrders: parseInt(result.rows[0].orders),
      totalRevenue: parseFloat(result.rows[0].revenue),
      totalWeight: parseFloat(result.rows[0].weight),
      topCustomers: topCustomers.rows.map(c => ({name: c.name, orders: parseInt(c.orders), total: parseFloat(c.total)}))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SETTINGS
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM settings');
    const settings = {};
    result.rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', authMiddleware, adminOnly, async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      await pool.query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
        [key, value]
      );
    }
    const result = await pool.query('SELECT key, value FROM settings');
    const settings = {};
    result.rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// USERS
app.get('/api/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, name, role FROM users ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { username, password, name, role } = req.body;
    const result = await pool.query(
      'INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4) RETURNING id, username, name, role',
      [username, password, name, role]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { username, password, name, role } = req.body;
    if (password) {
      await pool.query('UPDATE users SET username = $1, password = $2, name = $3, role = $4 WHERE id = $5', [username, password, name, role, req.params.id]);
    } else {
      await pool.query('UPDATE users SET username = $1, name = $2, role = $3 WHERE id = $4', [username, name, role, req.params.id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUBLIC ROUTES - CUSTOMER
app.post('/api/public/customer-login', async (req, res) => {
  try {
    const { phone, password, name, email, address, sms_consent } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });
    
    // Clean phone number - remove all non-digits
    const cleanPhone = phone.replace(/\D/g, '');
    console.log('Customer login attempt for phone:', cleanPhone);
    
    // Search for existing customer by cleaned phone
    const existing = await pool.query(
      "SELECT * FROM customers WHERE REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = $1",
      [cleanPhone]
    );
    console.log('Found customers:', existing.rows.length);
    
    if (existing.rows.length === 0) {
      // New customer registration
      if (!name) return res.status(400).json({ error: 'Name required for new customers. Please use the Register page.' });
      if (!password) return res.status(400).json({ error: 'Password required' });
      
      console.log('Creating new customer:', name, cleanPhone);
      const result = await pool.query(
        'INSERT INTO customers (name, phone, email, address, password, sms_consent) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [name, cleanPhone, email || '', address || '', password, sms_consent || false]
      );
      const customer = result.rows[0];
      console.log('Customer created with ID:', customer.id);
      const token = jwt.sign({ customerId: customer.id }, JWT_SECRET, { expiresIn: '30d' });
      return res.json({ customer: { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email, address: customer.address, paymentMethods: [] }, token, isNew: true });
    }
    
    // Existing customer login
    const customer = existing.rows[0];
    console.log('Existing customer found:', customer.id, customer.name);
    if (!password) return res.status(400).json({ error: 'Password required' });
    if (customer.password && customer.password !== password) {
      console.log('Password mismatch for customer:', customer.id);
      return res.status(401).json({ error: 'Invalid password' });
    }
    // If customer has no password yet (legacy), set it
    if (!customer.password) {
      await pool.query('UPDATE customers SET password = $1 WHERE id = $2', [password, customer.id]);
    }
    
    const token = jwt.sign({ customerId: customer.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ customer: { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email, address: customer.address, paymentMethods: customer.payment_methods || [] }, token, isNew: false });
  } catch (err) {
    console.error('Customer login error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.get('/api/public/customer-info', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query('SELECT * FROM customers WHERE id = $1', [decoded.customerId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    const c = result.rows[0];
    res.json({ id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address, paymentMethods: c.payment_methods || [] });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.get('/api/public/my-orders', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query('SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC', [decoded.customerId]);
    res.json(result.rows.map(o => ({...o, total: parseFloat(o.total)})));
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.post('/api/public/orders', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    
    const { customer_name, customer_phone, customer_email, customer_address, order_type, items, notes, payment_method } = req.body;
    const order_number = await getNextOrderNumber();
    
    const result = await pool.query(
      `INSERT INTO orders (order_number, customer_id, customer_name, customer_phone, customer_email, customer_address, order_type, items, notes, payment_method, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'received') RETURNING *`,
      [order_number, decoded.customerId, customer_name, customer_phone, customer_email, customer_address, order_type || 'pickup_delivery', JSON.stringify(items), notes, payment_method]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DRIVER
app.get('/api/driver/orders', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'driver' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Driver access required' });
    }
    const result = await pool.query(
      "SELECT * FROM orders WHERE status IN ('ready', 'collected') OR (status = 'received' AND order_type = 'pickup_delivery')"
    );
    res.json(result.rows.map(o => ({
      id: o.id, order_number: o.order_number, customer_name: o.customer_name,
      customer_phone: o.customer_phone, customer_address: o.customer_address,
      status: o.status, order_type: o.order_type, notes: o.notes, total: parseFloat(o.total || 0)
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check - tests database connection
app.get('/health', async (req, res) => {
  try {
    const dbCheck = await pool.query('SELECT NOW() as time, COUNT(*) as customers FROM customers');
    res.json({ 
      status: 'ok', 
      time: new Date().toISOString(),
      database: 'connected',
      dbTime: dbCheck.rows[0].time,
      customerCount: parseInt(dbCheck.rows[0].customers)
    });
  } catch (err) {
    res.json({ 
      status: 'error', 
      time: new Date().toISOString(),
      database: 'disconnected',
      error: err.message,
      hint: 'Make sure DATABASE_URL environment variable is set in Render'
    });
  }
});

// Diagnostic endpoint - check all customers
app.get('/api/debug/customers', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, phone, email, created_at FROM customers ORDER BY id DESC LIMIT 20');
    res.json({ 
      count: result.rows.length, 
      customers: result.rows,
      database_url_set: !!process.env.DATABASE_URL
    });
  } catch (err) {
    res.json({ error: err.message, database_url_set: !!process.env.DATABASE_URL });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3001;

initDB().then(() => {
  app.listen(PORT, () => console.log(`Kleen Panda server running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
