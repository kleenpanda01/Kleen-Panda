const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'kleen-panda-secret-2024';

// Email configuration (GoDaddy SMTP)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtpout.secureserver.net',
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: true, // SSL
  auth: {
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || ''
  }
});

// Send email helper
async function sendEmail(to, subject, html) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log('Email not configured - skipping send to:', to);
    return false;
  }
  try {
    await transporter.sendMail({
      from: `"Kleen Panda" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html
    });
    console.log('Email sent to:', to);
    return true;
  } catch (err) {
    console.error('Email error:', err.message);
    return false;
  }
}

// Send order notification to staff
async function sendOrderNotification(order) {
  const staffEmail = process.env.EMAIL_USER || 'sales@kleenpanda.com';
  const subject = `🧺 New Order ${order.order_number} - ${order.customer_name}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1B9AAA; color: white; padding: 20px; text-align: center;">
        <h1 style="margin: 0;">🐼 Kleen Panda</h1>
        <p style="margin: 5px 0;">New Pickup Order</p>
      </div>
      <div style="padding: 20px; background: #f8f9fa;">
        <h2 style="color: #1B9AAA;">Order ${order.order_number}</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Customer:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${order.customer_name}</td></tr>
          <tr><td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Phone:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><a href="tel:${order.customer_phone}">${order.customer_phone}</a></td></tr>
          <tr><td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Address:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${order.customer_address}</td></tr>
          <tr><td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Payment:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${order.payment_method || 'Pay Later'}</td></tr>
          <tr><td style="padding: 8px 0;"><strong>Notes:</strong></td><td style="padding: 8px 0;">${order.notes || 'None'}</td></tr>
        </table>
      </div>
      <div style="padding: 15px; background: #1B9AAA; color: white; text-align: center;">
        <p style="margin: 0;">Please process this order promptly!</p>
      </div>
    </div>
  `;
  return sendEmail(staffEmail, subject, html);
}

// Twilio SMS Configuration
const twilioClient = process.env.TWILIO_SID && process.env.TWILIO_AUTH 
  ? twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH)
  : null;
const twilioPhone = process.env.TWILIO_PHONE || '+18559187119';

// Send SMS helper
async function sendSMS(to, message) {
  if (!twilioClient) {
    console.log('Twilio not configured - TWILIO_SID:', !!process.env.TWILIO_SID, 'TWILIO_AUTH:', !!process.env.TWILIO_AUTH);
    return { success: false, error: 'Twilio not configured. Please add TWILIO_SID and TWILIO_AUTH environment variables.' };
  }
  try {
    // Format phone number - ensure it starts with +1 for US
    let phone = to.replace(/\D/g, '');
    if (phone.length === 10) phone = '1' + phone;
    if (!phone.startsWith('+')) phone = '+' + phone;
    
    console.log('Attempting to send SMS to:', phone, 'from:', twilioPhone);
    
    const result = await twilioClient.messages.create({
      body: message,
      from: twilioPhone,
      to: phone
    });
    console.log('SMS sent successfully, SID:', result.sid);
    return { success: true, sid: result.sid };
  } catch (err) {
    console.error('SMS error details:', err.code, err.message, err.moreInfo);
    return { success: false, error: err.message };
  }
}

// Send order confirmation SMS to customer
async function sendOrderSMS(order) {
  if (!order.customer_phone) return false;
  const message = `🐼 Kleen Panda: Order ${order.order_number} confirmed! We'll pick up your laundry at ${order.customer_address}. Questions? Call (347) 297-6088`;
  return sendSMS(order.customer_phone, message);
}

// Send SMS to staff about new order
async function sendStaffSMS(order) {
  const staffPhone = process.env.STAFF_PHONE; // Optional staff notification number
  if (!staffPhone) return false;
  const message = `📦 New Order ${order.order_number}\n${order.customer_name}\n${order.customer_phone}\n${order.customer_address}`;
  return sendSMS(staffPhone, message);
}

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
        subscription_plan VARCHAR(50),
        card_last_four VARCHAR(4),
        card_token TEXT,
        zelle_id VARCHAR(255),
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
        received_by VARCHAR(255),
        received_at TIMESTAMP,
        cleaned_by VARCHAR(255),
        cleaned_at TIMESTAMP,
        ready_by VARCHAR(255),
        ready_at TIMESTAMP,
        delivery_photo TEXT,
        delivered_at TIMESTAMP,
        delivered_by VARCHAR(255),
        pickup_by VARCHAR(255),
        pickup_at TIMESTAMP,
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
        machine_card_start DECIMAL(10,2) DEFAULT 0,
        machine_card_end DECIMAL(10,2) DEFAULT 0,
        shift_notes TEXT,
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
      
      CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        customer_name VARCHAR(255),
        customer_email VARCHAR(255),
        customer_phone VARCHAR(50),
        rating INTEGER,
        message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT
      );
    `);
    
    // MIGRATIONS: Add missing columns to existing tables
    console.log('Running migrations...');
    
    // Orders table migrations
    const orderColumns = [
      { name: 'received_by', type: 'VARCHAR(255)' },
      { name: 'received_at', type: 'TIMESTAMP' },
      { name: 'cleaned_by', type: 'VARCHAR(255)' },
      { name: 'cleaned_at', type: 'TIMESTAMP' },
      { name: 'ready_by', type: 'VARCHAR(255)' },
      { name: 'ready_at', type: 'TIMESTAMP' },
      { name: 'pickup_by', type: 'VARCHAR(255)' },
      { name: 'pickup_at', type: 'TIMESTAMP' }
    ];
    
    for (const col of orderColumns) {
      try {
        await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
      } catch (e) {
        // Column might already exist, that's fine
      }
    }
    
    // Time entries table migrations
    const timeColumns = [
      { name: 'machine_card_start', type: 'DECIMAL(10,2) DEFAULT 0' },
      { name: 'machine_card_end', type: 'DECIMAL(10,2) DEFAULT 0' },
      { name: 'shift_notes', type: 'TEXT' }
    ];
    
    for (const col of timeColumns) {
      try {
        await client.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
      } catch (e) {
        // Column might already exist
      }
    }
    
    // Create feedback table if not exists
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS feedback (
          id SERIAL PRIMARY KEY,
          customer_name VARCHAR(255),
          customer_email VARCHAR(255),
          customer_phone VARCHAR(50),
          rating INTEGER,
          message TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (e) {}
    
    // Customer table migrations
    const customerColumns = [
      { name: 'subscription_plan', type: 'VARCHAR(50)' },
      { name: 'card_last_four', type: 'VARCHAR(4)' },
      { name: 'card_token', type: 'TEXT' },
      { name: 'zelle_id', type: 'VARCHAR(255)' },
      { name: 'notification_preference', type: "VARCHAR(10) DEFAULT 'sms'" }
    ];
    
    for (const col of customerColumns) {
      try {
        await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
      } catch (e) {}
    }
    
    console.log('Migrations complete.');
    
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

app.post('/api/services', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, category, price, unit, description } = req.body;
    if (!name || !category || price === undefined) {
      return res.status(400).json({ error: 'Name, category, and price are required' });
    }
    const result = await pool.query(
      'INSERT INTO services (name, category, price, unit, description, active) VALUES ($1, $2, $3, $4, $5, true) RETURNING *',
      [name, category, price, unit || 'item', description || '']
    );
    res.json(result.rows[0]);
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
    const { name, phone, email, address, discount, subscription_plan, card_last_four, zelle_id } = req.body;
    const result = await pool.query(
      `UPDATE customers SET 
        name = COALESCE($1, name), 
        phone = COALESCE($2, phone), 
        email = COALESCE($3, email), 
        address = COALESCE($4, address), 
        discount = COALESCE($5, discount),
        subscription_plan = COALESCE($6, subscription_plan),
        card_last_four = COALESCE($7, card_last_four),
        zelle_id = COALESCE($8, zelle_id)
      WHERE id = $9 RETURNING *`,
      [name, phone, email, address, discount, subscription_plan, card_last_four, zelle_id, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE CUSTOMER (admin only)
app.delete('/api/customers/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    // Check if customer has orders
    const ordersCheck = await pool.query('SELECT COUNT(*) FROM orders WHERE customer_id = $1', [req.params.id]);
    const orderCount = parseInt(ordersCheck.rows[0].count);
    
    if (orderCount > 0) {
      // Just nullify the customer_id in orders rather than preventing delete
      await pool.query('UPDATE orders SET customer_id = NULL WHERE customer_id = $1', [req.params.id]);
    }
    
    await pool.query('DELETE FROM customers WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Customer deleted' });
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
    
    // Get tax rate from settings
    const settingsResult = await pool.query("SELECT value FROM settings WHERE key = 'tax_rate'");
    const taxRate = settingsResult.rows.length > 0 ? parseFloat(settingsResult.rows[0].value) / 100 : 0.08875;
    
    const subtotal = items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
    const discountAmount = subtotal * ((discount || 0) / 100);
    const afterDiscount = subtotal - discountAmount + (adjustment || 0);
    const tax = afterDiscount * taxRate;
    const total = Math.max(0, afterDiscount + tax);
    
    const result = await pool.query(
      `INSERT INTO orders (order_number, customer_id, customer_name, customer_phone, customer_email, customer_address, order_type, items, subtotal, tax, discount, adjustment, total, weight, payment_method, notes, created_by, created_by_name, received_by, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18, NOW()) RETURNING *`,
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
    const staffName = req.user.name;
    
    // Build dynamic update based on status
    let updateFields = 'status = $1, updated_at = NOW()';
    let params = [status];
    
    if (status === 'received') {
      updateFields += ', received_by = $3, received_at = NOW()';
      params.push(req.params.id, staffName);
    } else if (status === 'cleaned') {
      updateFields += ', cleaned_by = $3, cleaned_at = NOW()';
      params.push(req.params.id, staffName);
    } else if (status === 'ready') {
      updateFields += ', ready_by = $3, ready_at = NOW()';
      params.push(req.params.id, staffName);
    } else if (status === 'delivered') {
      updateFields += ', delivered_by = $3, delivered_at = NOW()';
      params.push(req.params.id, staffName);
    } else {
      params.push(req.params.id);
    }
    
    const result = await pool.query(
      `UPDATE orders SET ${updateFields} WHERE id = $2 RETURNING *`,
      params
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// General order update (weight, items, notes, adjustment, order_type)
app.put('/api/orders/:id', authMiddleware, async (req, res) => {
  try {
    const { weight, items, notes, adjustment, payment_status, order_type } = req.body;
    
    // Get current order to get tax rate from settings
    const settingsResult = await pool.query("SELECT value FROM settings WHERE key = 'tax_rate'");
    const taxRate = settingsResult.rows.length > 0 ? parseFloat(settingsResult.rows[0].value) / 100 : 0.08875;
    
    // Recalculate totals if items changed
    let subtotal = 0;
    if (items && items.length > 0) {
      subtotal = items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
    }
    
    const adj = adjustment || 0;
    const afterAdj = subtotal + adj;
    const tax = afterAdj * taxRate;
    const total = Math.max(0, afterAdj + tax);
    
    const result = await pool.query(
      `UPDATE orders SET 
        weight = COALESCE($1, weight),
        items = COALESCE($2, items),
        notes = COALESCE($3, notes),
        adjustment = COALESCE($4, adjustment),
        subtotal = CASE WHEN $2 IS NOT NULL THEN $5 ELSE subtotal END,
        tax = CASE WHEN $2 IS NOT NULL THEN $6 ELSE tax END,
        total = CASE WHEN $2 IS NOT NULL THEN $7 ELSE total END,
        payment_status = COALESCE($8, payment_status),
        order_type = COALESCE($10, order_type),
        updated_at = NOW()
      WHERE id = $9 RETURNING *`,
      [weight, items ? JSON.stringify(items) : null, notes, adjustment, subtotal, tax, total, payment_status, req.params.id, order_type]
    );
    res.json({...result.rows[0], total: parseFloat(result.rows[0].total)});
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

// CLEARENT CNP (Card Not Present) PAYMENT PROCESSING
app.post('/api/orders/:id/charge-card', authMiddleware, async (req, res) => {
  try {
    const { card_number, exp_date, cvv, amount, order_number } = req.body;
    
    // Get Clearent API key from settings or use default
    const settingsResult = await pool.query("SELECT value FROM settings WHERE key = 'clearent_api_key'");
    const apiKey = settingsResult.rows.length > 0 && settingsResult.rows[0].value 
      ? settingsResult.rows[0].value 
      : '89649998a14244c79ea29f6ffcd143c6';
    
    if (!apiKey) {
      return res.status(400).json({ error: 'Clearent API key not configured. Go to Settings to add it.' });
    }
    
    // Clean card number (remove spaces/dashes)
    const cleanCard = card_number.replace(/\D/g, '');
    
    // Format expiry date (MM/YY -> MMYY)
    const cleanExp = exp_date.replace(/\D/g, '');
    
    // Validate inputs
    if (cleanCard.length < 15 || cleanCard.length > 16) {
      return res.status(400).json({ error: 'Invalid card number' });
    }
    if (cleanExp.length !== 4) {
      return res.status(400).json({ error: 'Invalid expiry date (use MM/YY)' });
    }
    if (!cvv || cvv.length < 3) {
      return res.status(400).json({ error: 'Invalid CVV' });
    }
    
    console.log('Processing Clearent CNP payment for order:', order_number, 'amount:', amount);
    
    // Call Clearent API
    const clearentResponse = await fetch('https://gateway.clearent.net/rest/v2/transactions/sale', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': apiKey
      },
      body: JSON.stringify({
        type: 'SALE',
        card: cleanCard,
        'exp-date': cleanExp,
        csc: cvv,
        amount: parseFloat(amount).toFixed(2),
        'software-type': 'KleenPanda POS',
        'software-type-version': '1.0',
        'invoice': order_number || req.params.id
      })
    });
    
    const clearentData = await clearentResponse.json();
    console.log('Clearent response:', JSON.stringify(clearentData, null, 2));
    
    // Check response
    if (clearentData.code === '200' || clearentData.payload?.transaction?.result === 'APPROVED') {
      // Payment successful - update order
      await pool.query(
        'UPDATE orders SET payment_status = $1, payment_method = $2, updated_at = NOW() WHERE id = $3',
        ['paid', 'card', req.params.id]
      );
      
      res.json({ 
        success: true, 
        message: 'Payment approved!',
        transaction_id: clearentData.payload?.transaction?.id,
        last_four: cleanCard.slice(-4)
      });
    } else {
      // Payment failed
      const errorMsg = clearentData.payload?.error?.['error-message'] 
        || clearentData.payload?.transaction?.['display-message']
        || clearentData.message 
        || 'Payment declined';
      
      console.log('Clearent payment failed:', errorMsg);
      res.status(400).json({ error: errorMsg });
    }
  } catch (err) {
    console.error('Clearent payment error:', err);
    res.status(500).json({ error: 'Payment processing error: ' + err.message });
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

// DELETE ORDER (admin only)
app.delete('/api/orders/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM orders WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE ALL ORDERS (admin only)
app.delete('/api/orders', authMiddleware, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM orders');
    // Reset order number sequence
    await pool.query("DELETE FROM settings WHERE key = 'last_order_number'");
    res.json({ success: true, message: 'All orders deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TIME ENTRIES
app.get('/api/time-entries/status', authMiddleware, async (req, res) => {
  try {
    // Get current user's clock status
    const result = await pool.query(
      'SELECT * FROM time_entries WHERE user_id = $1 AND clock_out IS NULL',
      [req.user.id]
    );
    // Check if ANY staff is clocked in (for admin to see)
    const anyClocked = await pool.query(
      'SELECT te.*, u.role FROM time_entries te JOIN users u ON te.user_id = u.id WHERE te.clock_out IS NULL AND u.role = $1',
      ['staff']
    );
    res.json({ 
      clockedIn: result.rows.length > 0, 
      entry: result.rows[0],
      otherStaffClockedIn: anyClocked.rows.length > 0 ? anyClocked.rows[0] : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/time-entries/clock-in', authMiddleware, async (req, res) => {
  try {
    const { machine_card_start } = req.body;
    
    // Check if current user is already clocked in
    const selfCheck = await pool.query('SELECT id FROM time_entries WHERE user_id = $1 AND clock_out IS NULL', [req.user.id]);
    if (selfCheck.rows.length > 0) return res.status(400).json({ error: 'Already clocked in' });
    
    // Check if another STAFF member is clocked in (admin excluded from this check)
    if (req.user.role === 'staff') {
      const otherStaff = await pool.query(
        `SELECT te.*, u.name FROM time_entries te 
         JOIN users u ON te.user_id = u.id 
         WHERE te.clock_out IS NULL AND u.role = 'staff' AND te.user_id != $1`,
        [req.user.id]
      );
      if (otherStaff.rows.length > 0) {
        return res.status(400).json({ 
          error: `${otherStaff.rows[0].name} is still clocked in. Please clock them out first.`,
          otherStaff: otherStaff.rows[0]
        });
      }
    }
    
    const result = await pool.query(
      'INSERT INTO time_entries (user_id, user_name, clock_in, machine_card_start, date) VALUES ($1, $2, NOW(), $3, CURRENT_DATE) RETURNING *',
      [req.user.id, req.user.name, machine_card_start || 0]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Force clock out another staff member
app.post('/api/time-entries/force-clock-out', authMiddleware, async (req, res) => {
  try {
    const { user_id, machine_card_end } = req.body;
    const result = await pool.query(
      `UPDATE time_entries SET clock_out = NOW(), machine_card_end = $2, hours_worked = EXTRACT(EPOCH FROM (NOW() - clock_in))/3600 
       WHERE user_id = $1 AND clock_out IS NULL RETURNING *`,
      [user_id, machine_card_end || 0]
    );
    if (result.rows.length === 0) return res.status(400).json({ error: 'Staff member not clocked in' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/time-entries/clock-out', authMiddleware, async (req, res) => {
  try {
    const { machine_card_end, shift_notes } = req.body;
    const result = await pool.query(
      `UPDATE time_entries SET clock_out = NOW(), machine_card_end = $2, shift_notes = $3, hours_worked = EXTRACT(EPOCH FROM (NOW() - clock_in))/3600 
       WHERE user_id = $1 AND clock_out IS NULL RETURNING *`,
      [req.user.id, machine_card_end || 0, shift_notes || '']
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
    const { start, end, period, compare } = req.query;
    let startDate, endDate;
    
    if (start && end) {
      startDate = new Date(start);
      endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);
    } else if (period === 'today') {
      startDate = new Date(); startDate.setHours(0, 0, 0, 0);
      endDate = new Date();
    } else if (period === 'this_week') {
      startDate = new Date(); startDate.setDate(startDate.getDate() - 7);
      endDate = new Date();
    } else {
      startDate = new Date(); startDate.setMonth(startDate.getMonth() - 1);
      endDate = new Date();
    }
    
    // Calculate prior period dates
    const periodLength = endDate - startDate;
    let priorStartDate, priorEndDate;
    
    if (compare === 'prior_year') {
      priorStartDate = new Date(startDate);
      priorStartDate.setFullYear(priorStartDate.getFullYear() - 1);
      priorEndDate = new Date(endDate);
      priorEndDate.setFullYear(priorEndDate.getFullYear() - 1);
    } else {
      // Prior period (same length, immediately before)
      priorEndDate = new Date(startDate.getTime() - 1);
      priorStartDate = new Date(priorEndDate.getTime() - periodLength);
    }
    
    // Current period totals
    const result = await pool.query(
      'SELECT COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue, COALESCE(SUM(weight), 0) as weight FROM orders WHERE created_at BETWEEN $1 AND $2',
      [startDate, endDate]
    );
    
    // Prior period totals
    const priorResult = await pool.query(
      'SELECT COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue, COALESCE(SUM(weight), 0) as weight FROM orders WHERE created_at BETWEEN $1 AND $2',
      [priorStartDate, priorEndDate]
    );
    
    // Daily data for charts (current period)
    const dailyData = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue 
       FROM orders WHERE created_at BETWEEN $1 AND $2 
       GROUP BY DATE(created_at) ORDER BY date`,
      [startDate, endDate]
    );
    
    // Daily data for prior period
    const priorDailyData = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue 
       FROM orders WHERE created_at BETWEEN $1 AND $2 
       GROUP BY DATE(created_at) ORDER BY date`,
      [priorStartDate, priorEndDate]
    );
    
    // Top customers
    const topCustomers = await pool.query(
      `SELECT customer_name as name, COUNT(*) as orders, SUM(total) as total 
       FROM orders WHERE created_at BETWEEN $1 AND $2 
       AND customer_name IS NOT NULL AND customer_name != ''
       GROUP BY customer_name ORDER BY total DESC LIMIT 10`,
      [startDate, endDate]
    );
    
    res.json({
      totalOrders: parseInt(result.rows[0].orders),
      totalRevenue: parseFloat(result.rows[0].revenue),
      totalWeight: parseFloat(result.rows[0].weight),
      priorOrders: parseInt(priorResult.rows[0].orders),
      priorRevenue: parseFloat(priorResult.rows[0].revenue),
      priorWeight: parseFloat(priorResult.rows[0].weight),
      dailyData: dailyData.rows.map(d => ({ date: new Date(d.date).toLocaleDateString('en-US', {month:'short',day:'numeric'}), orders: parseInt(d.orders), revenue: parseFloat(d.revenue) })),
      priorDailyData: priorDailyData.rows.map(d => ({ date: new Date(d.date).toLocaleDateString('en-US', {month:'short',day:'numeric'}), orders: parseInt(d.orders), revenue: parseFloat(d.revenue) })),
      topCustomers: topCustomers.rows.map(c => ({name: c.name, orders: parseInt(c.orders), total: parseFloat(c.total)})),
      dateRange: { start: startDate.toISOString().slice(0,10), end: endDate.toISOString().slice(0,10) },
      priorDateRange: { start: priorStartDate.toISOString().slice(0,10), end: priorEndDate.toISOString().slice(0,10) }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PRINT TEST
app.post('/api/print/test', authMiddleware, async (req, res) => {
  try {
    // Get printer settings
    const settingsResult = await pool.query("SELECT key, value FROM settings WHERE key LIKE 'printer_%'");
    const settings = {};
    settingsResult.rows.forEach(r => settings[r.key] = r.value);
    
    if (!settings.printer_type) {
      return res.status(400).json({ error: 'No printer configured' });
    }
    
    // For now, just log the print request
    // In production, you would integrate with a print service like:
    // - node-thermal-printer for USB/Network ESC/POS printers
    // - Google Cloud Print API
    // - PrintNode API
    console.log('Test print requested:', settings);
    
    // Simulate print (in real implementation, send to printer)
    const testReceipt = `
================================
        KLEEN PANDA
     TEST RECEIPT PRINT
================================
Date: ${new Date().toLocaleString()}
Printer: ${settings.printer_type}
Connection: ${settings.printer_connection}
${settings.printer_ip ? 'IP: ' + settings.printer_ip : ''}
Paper Width: ${settings.printer_width || '80'}mm
================================
    If you see this, your
    printer is configured
         correctly!
================================
    `;
    
    console.log(testReceipt);
    
    res.json({ success: true, message: 'Test print sent' });
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

// FEEDBACK
app.post('/api/public/feedback', async (req, res) => {
  try {
    const { customer_name, customer_email, customer_phone, rating, message } = req.body;
    
    // Save feedback
    const result = await pool.query(
      'INSERT INTO feedback (customer_name, customer_email, customer_phone, rating, message) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [customer_name, customer_email, customer_phone, rating, message]
    );
    
    // Get notification email from settings
    const settingsResult = await pool.query("SELECT value FROM settings WHERE key = 'notification_email'");
    const notifyEmail = settingsResult.rows.length > 0 ? settingsResult.rows[0].value : 'sales@kleenpanda.com';
    
    // Send email notification
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1B9AAA; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0;">🐼 New Customer Feedback</h1>
        </div>
        <div style="padding: 20px; background: #f8f9fa;">
          <p><strong>From:</strong> ${customer_name || 'Anonymous'}</p>
          <p><strong>Email:</strong> ${customer_email || 'Not provided'}</p>
          <p><strong>Phone:</strong> ${customer_phone || 'Not provided'}</p>
          <p><strong>Rating:</strong> ${'⭐'.repeat(rating || 0)}</p>
          <p><strong>Message:</strong></p>
          <p style="background: white; padding: 15px; border-radius: 8px;">${message}</p>
        </div>
      </div>
    `;
    sendEmail(notifyEmail, '🐼 New Customer Feedback - Kleen Panda', html);
    
    res.json({ success: true, message: 'Thank you for your feedback!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// STAFF PRODUCTIVITY REPORT
app.get('/api/staff-productivity', authMiddleware, async (req, res) => {
  try {
    const { start, end, user_id } = req.query;
    const startDate = start || new Date().toISOString().slice(0, 10);
    const endDate = end || new Date().toISOString().slice(0, 10);
    
    // Get orders processed by each staff member in date range
    let query = `
      SELECT 
        COALESCE(received_by, created_by_name, 'Unknown') as staff_name,
        COUNT(*) FILTER (WHERE received_by IS NOT NULL OR created_by_name IS NOT NULL) as orders_received,
        COUNT(*) FILTER (WHERE cleaned_by IS NOT NULL) as orders_cleaned,
        COUNT(*) FILTER (WHERE ready_by IS NOT NULL) as orders_ready,
        COUNT(*) FILTER (WHERE pickup_by IS NOT NULL) as pickups_processed,
        COALESCE(SUM(CASE WHEN payment_status = 'paid' AND payment_method = 'cash' THEN total ELSE 0 END), 0) as cash_collected,
        array_agg(DISTINCT order_number) FILTER (WHERE received_by IS NOT NULL OR cleaned_by IS NOT NULL OR ready_by IS NOT NULL) as order_numbers
      FROM orders 
      WHERE DATE(created_at) BETWEEN $1 AND $2
      AND (received_by IS NOT NULL OR created_by_name IS NOT NULL)
    `;
    
    const params = [startDate, endDate];
    
    if (user_id) {
      query += ' AND (created_by = $3 OR received_by = (SELECT name FROM users WHERE id = $3) OR cleaned_by = (SELECT name FROM users WHERE id = $3) OR ready_by = (SELECT name FROM users WHERE id = $3))';
      params.push(user_id);
    }
    
    query += ' GROUP BY COALESCE(received_by, created_by_name, \'Unknown\') HAVING COALESCE(received_by, created_by_name, \'Unknown\') IS NOT NULL';
    
    const result = await pool.query(query, params);
    
    // Get time entries for the period
    const timeQuery = `
      SELECT user_name, 
        SUM(hours_worked) as total_hours,
        SUM(COALESCE(machine_card_start, 0) - COALESCE(machine_card_end, 0)) as machine_card_usage,
        COUNT(*) as shifts,
        MIN(date) as first_shift,
        MAX(date) as last_shift
      FROM time_entries 
      WHERE date BETWEEN $1 AND $2
      ${user_id ? 'AND user_id = $3' : ''}
      GROUP BY user_name
    `;
    
    const timeResult = await pool.query(timeQuery, user_id ? [startDate, endDate, user_id] : [startDate, endDate]);
    
    res.json({
      productivity: result.rows.filter(r => r.staff_name && r.staff_name !== 'null'),
      timeEntries: timeResult.rows
    });
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
    const { phone, email, password, name, address, sms_consent, subscription_plan, notification_preference } = req.body;
    if (!phone && !email) return res.status(400).json({ error: 'Phone number or email required' });
    
    let customer = null;
    let cleanPhone = null;
    
    // Get ALL customers for matching
    const allCustomers = await pool.query('SELECT * FROM customers');
    
    if (phone) {
      // Phone login - clean and match last 10 digits
      cleanPhone = phone.replace(/\D/g, '').slice(-10);
      if (cleanPhone.length < 10) {
        return res.status(400).json({ error: 'Please enter a valid 10-digit phone number' });
      }
      console.log('Customer login attempt by phone:', cleanPhone);
      customer = allCustomers.rows.find(c => {
        const dbPhone = (c.phone || '').replace(/\D/g, '').slice(-10);
        return dbPhone === cleanPhone;
      });
    } else if (email) {
      // Email login - case insensitive match
      console.log('Customer login attempt by email:', email);
      customer = allCustomers.rows.find(c => 
        c.email && c.email.toLowerCase() === email.toLowerCase()
      );
      if (!customer) {
        return res.status(401).json({ error: 'No account found with this email. Try your phone number or register.' });
      }
    }
    
    console.log('Found customer:', customer ? customer.id : 'none');
    
    if (!customer) {
      // New customer registration (only via phone)
      if (!phone) return res.status(400).json({ error: 'Phone number required to create account' });
      if (!name) return res.status(400).json({ error: 'Name required for new customers. Please use the Register page.' });
      if (!password) return res.status(400).json({ error: 'Password required' });
      
      // Set discount based on subscription plan
      const discount = subscription_plan ? 14 : 0;
      
      console.log('Creating new customer:', name, cleanPhone, 'plan:', subscription_plan);
      const result = await pool.query(
        'INSERT INTO customers (name, phone, email, address, password, sms_consent, subscription_plan, discount, notification_preference) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
        [name, cleanPhone, req.body.email || '', address || '', password, sms_consent || false, subscription_plan || null, discount, notification_preference || 'sms']
      );
      const newCustomer = result.rows[0];
      console.log('Customer created with ID:', newCustomer.id);
      const token = jwt.sign({ customerId: newCustomer.id }, JWT_SECRET, { expiresIn: '30d' });
      return res.json({ customer: { id: newCustomer.id, name: newCustomer.name, phone: newCustomer.phone, email: newCustomer.email, address: newCustomer.address, subscription_plan: newCustomer.subscription_plan, notification_preference: newCustomer.notification_preference, paymentMethods: [] }, token, isNew: true });
    }
    
    // Existing customer login
    console.log('Existing customer found:', customer.id, customer.name, 'stored password:', customer.password ? 'yes' : 'no');
    if (!password) return res.status(400).json({ error: 'Password required' });
    if (customer.password && customer.password !== password) {
      console.log('Password mismatch - entered:', password, 'stored:', customer.password);
      return res.status(401).json({ error: 'Invalid password. Try again or use Forgot Password.' });
    }
    // If customer has no password yet (legacy), set it
    if (!customer.password) {
      await pool.query('UPDATE customers SET password = $1 WHERE id = $2', [password, customer.id]);
      console.log('Set password for legacy customer');
    }
    
    const token = jwt.sign({ customerId: customer.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ customer: { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email, address: customer.address, subscription_plan: customer.subscription_plan, paymentMethods: customer.payment_methods || [] }, token, isNew: false });
  } catch (err) {
    console.error('Customer login error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// Password reset - request code
const resetCodes = new Map(); // In-memory store for reset codes
app.post('/api/public/request-reset', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });
    
    const cleanPhone = phone.replace(/\D/g, '');
    const allCustomers = await pool.query('SELECT * FROM customers');
    const customer = allCustomers.rows.find(c => {
      const dbPhone = (c.phone || '').replace(/\D/g, '');
      return dbPhone === cleanPhone || dbPhone.endsWith(cleanPhone) || cleanPhone.endsWith(dbPhone);
    });
    
    if (!customer) {
      return res.status(404).json({ error: 'No account found with this phone number' });
    }
    
    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    resetCodes.set(cleanPhone, { code, expires: Date.now() + 10 * 60 * 1000, customerId: customer.id }); // 10 min expiry
    
    // Send SMS with code
    const result = await sendSMS(cleanPhone, `🐼 Kleen Panda: Your password reset code is ${code}. This code expires in 10 minutes.`);
    
    if (result.success) {
      res.json({ success: true, message: 'Reset code sent to your phone' });
    } else {
      res.status(500).json({ error: result.error || 'Failed to send SMS. Please try again.' });
    }
  } catch (err) {
    console.error('Reset request error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Password reset - verify code and set new password
app.post('/api/public/reset-password', async (req, res) => {
  try {
    const { phone, code, newPassword } = req.body;
    if (!phone || !code || !newPassword) {
      return res.status(400).json({ error: 'Phone, code, and new password required' });
    }
    
    const cleanPhone = phone.replace(/\D/g, '');
    const resetData = resetCodes.get(cleanPhone);
    
    if (!resetData) {
      return res.status(400).json({ error: 'No reset code found. Please request a new one.' });
    }
    
    if (Date.now() > resetData.expires) {
      resetCodes.delete(cleanPhone);
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    }
    
    if (resetData.code !== code) {
      return res.status(400).json({ error: 'Invalid code' });
    }
    
    // Update password
    await pool.query('UPDATE customers SET password = $1 WHERE id = $2', [newPassword, resetData.customerId]);
    resetCodes.delete(cleanPhone);
    
    res.json({ success: true, message: 'Password updated successfully!' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: err.message });
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
    
    // Get customer info first
    const customerResult = await pool.query('SELECT * FROM customers WHERE id = $1', [decoded.customerId]);
    const customer = customerResult.rows[0];
    
    // Find orders by customer_id OR by phone number (to catch orders created before linking)
    let result;
    if (customer && customer.phone) {
      const cleanPhone = customer.phone.replace(/\D/g, '').slice(-10);
      result = await pool.query(
        `SELECT * FROM orders WHERE customer_id = $1 
         OR REPLACE(REPLACE(REPLACE(customer_phone, '-', ''), '(', ''), ')', '') LIKE '%' || $2 || '%'
         ORDER BY created_at DESC`,
        [decoded.customerId, cleanPhone]
      );
    } else {
      result = await pool.query('SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC', [decoded.customerId]);
    }
    
    res.json(result.rows.map(o => ({...o, total: parseFloat(o.total || 0)})));
  } catch (err) {
    console.error('My orders error:', err);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Customer can edit notes on their order (before cleaned status)
app.put('/api/public/orders/:id', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    
    const { notes } = req.body;
    
    // Check order belongs to customer and is not yet cleaned
    const orderCheck = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    const order = orderCheck.rows[0];
    
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    // Verify ownership (by customer_id or phone)
    const customerResult = await pool.query('SELECT * FROM customers WHERE id = $1', [decoded.customerId]);
    const customer = customerResult.rows[0];
    const orderPhone = (order.customer_phone || '').replace(/\D/g, '').slice(-10);
    const custPhone = (customer?.phone || '').replace(/\D/g, '').slice(-10);
    
    if (order.customer_id !== decoded.customerId && orderPhone !== custPhone) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    // Only allow edit before cleaned
    if (['cleaned', 'ready', 'delivered'].includes(order.status)) {
      return res.status(400).json({ error: 'Order is already being processed and cannot be edited' });
    }
    
    await pool.query('UPDATE orders SET notes = $1 WHERE id = $2', [notes, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Customer can cancel their order (before cleaned status)
app.post('/api/public/orders/:id/cancel', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check order belongs to customer and is not yet cleaned
    const orderCheck = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    const order = orderCheck.rows[0];
    
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    // Verify ownership
    const customerResult = await pool.query('SELECT * FROM customers WHERE id = $1', [decoded.customerId]);
    const customer = customerResult.rows[0];
    const orderPhone = (order.customer_phone || '').replace(/\D/g, '').slice(-10);
    const custPhone = (customer?.phone || '').replace(/\D/g, '').slice(-10);
    
    if (order.customer_id !== decoded.customerId && orderPhone !== custPhone) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    // Only allow cancel before cleaned
    if (['cleaned', 'ready', 'delivered'].includes(order.status)) {
      return res.status(400).json({ error: 'Order is already being processed and cannot be cancelled' });
    }
    
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', ['cancelled', req.params.id]);
    res.json({ success: true, message: 'Order cancelled' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    
    const order = result.rows[0];
    
    // Send email notification to staff
    sendOrderNotification(order);
    
    // Send SMS confirmation to customer
    sendOrderSMS(order);
    
    // Optionally send SMS to staff
    sendStaffSMS(order);
    
    // Send confirmation to customer if they have email
    if (customer_email) {
      sendEmail(customer_email, `✅ Order ${order_number} Confirmed - Kleen Panda`, `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1B9AAA; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">🐼 Kleen Panda</h1>
            <p style="margin: 5px 0;">Order Confirmation</p>
          </div>
          <div style="padding: 20px; background: #f8f9fa;">
            <h2 style="color: #28a745;">✅ Thank you for your order!</h2>
            <p>Hi ${customer_name},</p>
            <p>Your pickup has been scheduled. We'll be in touch soon!</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Order #:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${order_number}</td></tr>
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Pickup Address:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${customer_address}</td></tr>
              <tr><td style="padding: 8px 0;"><strong>Notes:</strong></td><td style="padding: 8px 0;">${notes || 'None'}</td></tr>
            </table>
          </div>
          <div style="padding: 15px; background: #1B9AAA; color: white; text-align: center;">
            <p style="margin: 0;">Questions? Call us at (347) 297-6088</p>
            <p style="margin: 5px 0; font-size: 12px;">113 E Tremont Ave, Bronx, NY</p>
          </div>
        </div>
      `);
    }
    
    res.json(order);
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
    // Only show pickup/delivery orders, not walk-in orders
    const result = await pool.query(
      "SELECT * FROM orders WHERE order_type = 'pickup_delivery' AND status IN ('received', 'collected', 'ready')"
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
