const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'replace-this-secret-before-deploying';
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'nook-market.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, slug TEXT UNIQUE NOT NULL, icon TEXT NOT NULL DEFAULT '✳');
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category_id INTEGER REFERENCES categories(id), price REAL NOT NULL, compare_price REAL, description TEXT NOT NULL, image TEXT NOT NULL, stock INTEGER NOT NULL DEFAULT 0, featured INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), status TEXT NOT NULL DEFAULT 'pending', total REAL NOT NULL, customer_name TEXT NOT NULL, address TEXT NOT NULL, payment_method TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id), product_id INTEGER REFERENCES products(id), name TEXT NOT NULL, price REAL NOT NULL, quantity INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), product_id INTEGER REFERENCES products(id), rating INTEGER NOT NULL, comment TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS coupons (id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, discount REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1, uses INTEGER NOT NULL DEFAULT 0);
`);
const orderColumns=db.prepare('PRAGMA table_info(orders)').all().map(column=>column.name);
if(!orderColumns.includes('phone')) db.exec('ALTER TABLE orders ADD COLUMN phone TEXT');
const productColumns=db.prepare('PRAGMA table_info(products)').all().map(column=>column.name);
if(!productColumns.includes('name_ar')) db.exec('ALTER TABLE products ADD COLUMN name_ar TEXT');
if(!productColumns.includes('description_ar')) db.exec('ALTER TABLE products ADD COLUMN description_ar TEXT');
const categoryColumns=db.prepare('PRAGMA table_info(categories)').all().map(column=>column.name);
if(!categoryColumns.includes('name_ar')) db.exec('ALTER TABLE categories ADD COLUMN name_ar TEXT');
const categories = [
  ['Home & Living','home','⌂'], ['Laptop Accessories ','Laptop Accessories','◉'], ['fashion','fashion','◇'], ['watch','watch','✳'], ['Audio & Headphones','Audio & Headphones','♨']
];
const addCat = db.prepare('INSERT OR IGNORE INTO categories(name,slug,icon) VALUES(?,?,?)');
categories.forEach(c => addCat.run(...c));
const catId = slug => db.prepare('SELECT id FROM categories WHERE slug=?').get(slug).id;
const seed = [
  ['Mini Printer Thermal Paper Label Stickers; Colored Self-Adhesive Thermal Printing Paper; Inkless Printing, Suitable for Photo And Image Printing, an Ideal Choice for Home, School, And Office Use - Self-Adhesive Thermal Label Paper','home',224,250,'A sculptural little light for slow evenings. Handmade stoneware base, warm linen shade.','https://img.kwcdn.com/product/open/5647978f472f4b4f8b1340902240c404-goods.jpeg?imageView2/2/w/300/q/70/format/avif',18,1],
  ['2pcs MINI Laptop Stand - Adjustable Notebook Holder Computer Holder Radiator Folding Portable Base Heightening Stand','Laptop Accessories',179,250,'A comfortable and adjustable laptop stand for improved ergonomics.','https://img.kwcdn.com/product/fancy/bd52dda1-057c-4a04-8eaa-583c497a281d.jpg?imageView2/2/w/800/q/70/format/avif',12,1],
  ['1 8-In-1 USB C Hub with Audio Jack | Compatible with Tablets, USB Powered, 5V Operating Voltage','Laptop Accessories',300,500,'A versatile USB C hub with audio jack, perfect for connecting to various devices.','https://img.kwcdn.com/product/fancy/3de155cc-e1a6-4e5f-9e69-9fe62ad372b4.jpg?imageView2/2/w/800/q/70/format/avif',42,1],
  ['','watch',219,350,'Notes of cedar, bergamot and a little quiet. Hand-poured soy wax, 45-hour burn.','https://img.kwcdn.com/product/fancy/636df504-3ee7-411c-970c-d984696e59b2.jpg?imageView2/2/w/1300/q/90/format/avif',27,1],
  ['Stack Stoneware Set','Audio & Headphones',64,null,'Four thoughtfully shaped stoneware mugs in a soft, speckled glaze. Dishwasher safe.','https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=900&q=85',9,1],
  ['Soft Form Lounge Chair','home',445,399,'An inviting silhouette with a solid ash frame and naturally textured upholstery.','https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?auto=format&fit=crop&w=900&q=85',5,0],
  ['Pocket Film Camera','Laptop Accessories',79,null,'Bring the happy accidents back. Simple controls, built-in flash, instant good memories.','https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=85',14,0],
  ['Linen Weekend Shirt','fashion',85,105,'Relaxed, breathable European flax linen. An easy layer, made to get better with time.','https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=900&q=85',22,0],
  ['Daily Notes Journal','watch',24,null,'A calm place to collect the little things. Recycled paper, lay-flat binding, 160 pages.','https://images.unsplash.com/photo-1531346878377-a5be20888e57?auto=format&fit=crop&w=900&q=85',33,0],
   ['Available in 5 Models, the Lightweight Wireless Side-insert USB All-in-one Docking Station Is a Multi-functional Multi-port Expander Suitable for Computers/tablets/phones. It Features a Type-C/USB 3.0 Hub Adapter with USB 2.0*3 + USB 3.0*1','Laptop Accessories',200,350,'A calm place to collect the little things. , lay-flat binding, 160 pages.','https://img.kwcdn.com/product/fancy/e8533feb-c5f5-4ee4-a403-558e331e2be9.jpg?imageView2/2/w/1300/q/90/format/avif',33,0],
]
  
const addProduct = db.prepare('INSERT INTO products(name,category_id,price,compare_price,description,image,stock,featured) VALUES(?,?,?,?,?,?,?,?)');
if (!db.prepare('SELECT 1 FROM products LIMIT 1').get()) seed.forEach(p => addProduct.run(p[0],catId(p[1]),...p.slice(2)));
db.prepare('INSERT OR IGNORE INTO coupons(code,discount) VALUES(?,?)').run('WELCOME10',10);
if (!db.prepare('SELECT 1 FROM users WHERE email=?').get('admin@nook.local')) {
  db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run('Nook Admin','admin@nook.local',bcrypt.hashSync('Nk7$mPx92!vQeR',10),'admin');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
const auth = (req,res,next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  try { req.user = jwt.verify(token, SECRET); next(); } catch { res.status(401).json({error:'Please sign in to continue.'}); }
};
const admin = (req,res,next) => req.user?.role === 'admin' ? next() : res.status(403).json({error:'Admin access required.'});
const productsQuery = `SELECT p.*, c.name category, c.slug category_slug, COALESCE(ROUND(AVG(r.rating),1),0) rating, COUNT(r.id) review_count FROM products p JOIN categories c ON c.id=p.category_id LEFT JOIN reviews r ON r.product_id=p.id`;
app.get('/api/categories', (req,res) => res.json(db.prepare('SELECT * FROM categories ORDER BY name').all()));
app.get('/api/products', (req,res) => {
  let sql = productsQuery + ' WHERE 1=1', args=[];
  if (req.query.category) { sql += ' AND c.slug=?'; args.push(req.query.category); }
  if (req.query.search) { sql += ' AND (p.name LIKE ? OR p.description LIKE ?)'; args.push(`%${req.query.search}%`,`%${req.query.search}%`); }
  sql += ' GROUP BY p.id';
  if (req.query.sort === 'price-asc') sql += ' ORDER BY p.price ASC';
  else if (req.query.sort === 'price-desc') sql += ' ORDER BY p.price DESC';
  else if (req.query.sort === 'rating') sql += ' ORDER BY rating DESC';
  else if (req.query.sort === 'latest') sql += ' ORDER BY p.created_at DESC';
  else sql += ' ORDER BY p.featured DESC, p.id DESC';
  res.json(db.prepare(sql).all(...args));
});
app.get('/api/products/:id', (req,res) => {
  const product = db.prepare(productsQuery+' WHERE p.id=? GROUP BY p.id').get(req.params.id);
  if (!product) return res.status(404).json({error:'Product not found.'});
  product.reviews = db.prepare('SELECT r.*, u.name FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=? ORDER BY r.id DESC').all(product.id); res.json(product);
});
app.post('/api/auth/signup', (req,res) => {
  const {name,email,password} = req.body || {};
  if (!name || !email || !password || password.length<8) return res.status(400).json({error:'Enter your name, email and a password with at least 8 characters.'});
  try { const result = db.prepare('INSERT INTO users(name,email,password) VALUES(?,?,?)').run(name.trim(),email.trim().toLowerCase(),bcrypt.hashSync(password,10)); const user={id:Number(result.lastInsertRowid),name:name.trim(),email:email.trim().toLowerCase(),role:'customer'}; res.json({user,token:jwt.sign(user,SECRET,{expiresIn:'7d'})}); }
  catch { res.status(409).json({error:'An account with that email already exists.'}); }
});
app.post('/api/auth/login', (req,res) => {
  const {email,password}=req.body||{}, row=db.prepare('SELECT * FROM users WHERE email=?').get((email||'').trim().toLowerCase());
  if (!row || !bcrypt.compareSync(password||'',row.password)) return res.status(401).json({error:'Email or password is incorrect.'});
  const user={id:row.id,name:row.name,email:row.email,role:row.role}; res.json({user,token:jwt.sign(user,SECRET,{expiresIn:'7d'})});
});
app.get('/api/me',auth,(req,res)=>res.json(req.user));
app.get('/api/orders',auth,(req,res)=>{
  const rows = req.user.role==='admin' ? db.prepare('SELECT o.*,u.email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC').all() : db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC').all(req.user.id);
  res.json(rows.map(o=>({...o,items:db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id)})));
});
app.post('/api/orders',auth,(req,res)=>{
  const {items,name,address,phone,paymentMethod,coupon}=req.body||{};
  if (!Array.isArray(items)||!items.length||!name||!address||!phone||!paymentMethod) return res.status(400).json({error:'Complete your delivery and payment details.'});
  const create=db.transaction(()=>{
    let total=0, selected=[];
    for(const item of items){const p=db.prepare('SELECT * FROM products WHERE id=?').get(Number(item.id)); const qty=Number(item.quantity); if(!p||!Number.isInteger(qty)||qty<1||qty>p.stock) throw new Error(`EGP{p?.name||'A product'} does not have enough stock.`); total+=p.price*qty; selected.push({p,qty});}
    if(coupon){const valid=db.prepare('SELECT * FROM coupons WHERE upper(code)=upper(?) AND active=1').get(coupon);if(!valid)throw new Error('That coupon is no longer active.');total=total*(1-valid.discount/500);db.prepare('UPDATE coupons SET uses=uses+1 WHERE id=?').run(valid.id);}
   const o=db.prepare('INSERT INTO orders(user_id,total,customer_name,address,phone,payment_method) VALUES(?,?,?,?,?,?)').run(req.user.id,total,name,address,phone,paymentMethod);
    for(const {p,qty} of selected){db.prepare('INSERT INTO order_items(order_id,product_id,name,price,quantity) VALUES(?,?,?,?,?)').run(o.lastInsertRowid,p.id,p.name,p.price,qty);db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(qty,p.id);}
    return Number(o.lastInsertRowid);
  });
  try {res.status(201).json(db.prepare('SELECT * FROM orders WHERE id=?').get(create()));} catch(e){res.status(400).json({error:e.message});}
});
app.get('/api/coupons/:code',(req,res)=>{const c=db.prepare('SELECT * FROM coupons WHERE upper(code)=upper(?) AND active=1').get(req.params.code); c?res.json(c):res.status(404).json({error:'That code is not active.'});});
app.post('/api/reviews',auth,(req,res)=>{const {productId,rating,comment}=req.body||{};if(!Number.isInteger(rating)||rating<1||rating>5||!comment?.trim())return res.status(400).json({error:'Add a rating and a short review.'});db.prepare('INSERT INTO reviews(user_id,product_id,rating,comment) VALUES(?,?,?,?)').run(req.user.id,productId,rating,comment.trim());res.status(201).json({ok:true});});
app.get('/api/admin/analytics',auth,admin,(req,res)=>{
  res.json({revenue:db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status!='cancelled'").get().n,orders:db.prepare('SELECT COUNT(*) n FROM orders').get().n,products:db.prepare('SELECT COUNT(*) n FROM products').get().n,customers:db.prepare("SELECT COUNT(*) n FROM users WHERE role='customer'").get().n,recent:db.prepare('SELECT o.*,u.name FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 6').all()});
});
app.post('/api/admin/products',auth,admin,(req,res)=>{const {name,name_ar,category_id,price,compare_price,description,description_ar,image,stock}=req.body;try{const result=db.prepare('INSERT INTO products(name,name_ar,category_id,price,compare_price,description,description_ar,image,stock) VALUES(?,?,?,?,?,?,?,?,?)').run(name,name_ar,category_id,price,compare_price||null,description,description_ar,image,stock);res.status(201).json({id:result.lastInsertRowid});}catch(e){res.status(400).json({error:'Check all product fields and try again.'});}});
app.put('/api/admin/products/:id',auth,admin,(req,res)=>{const {name,name_ar,category_id,price,compare_price,description,description_ar,image,stock}=req.body;try{db.prepare('UPDATE products SET name=?,name_ar=?,category_id=?,price=?,compare_price=?,description=?,description_ar=?,image=?,stock=? WHERE id=?').run(name,name_ar,category_id,price,compare_price||null,description,description_ar,image,stock,req.params.id);res.json({ok:true});}catch(e){res.status(400).json({error:'Check all product fields and try again.'});}});
app.delete('/api/admin/products/:id',auth,admin,(req,res)=>{db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);res.json({ok:true});});
app.post('/api/admin/categories',auth,admin,(req,res)=>{const {name,icon='✳'}=req.body;try{const slug=name.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');db.prepare('INSERT INTO categories(name,slug,icon) VALUES(?,?,?)').run(name,slug,icon);res.json({ok:true});}catch(e){res.status(400).json({error:'Category name already exists.'});}});
app.post('/api/admin/coupons',auth,admin,(req,res)=>{const {code,discount}=req.body;try{db.prepare('INSERT INTO coupons(code,discount) VALUES(?,?)').run(code.toUpperCase(),discount);res.json({ok:true});}catch(e){res.status(400).json({error:'Coupon code already exists.'});}});
app.patch('/api/admin/orders/:id',auth,admin,(req,res)=>{const allowed=['pending','confirmed','shipped','delivered','cancelled'];if(!allowed.includes(req.body.status))return res.status(400).json({error:'Invalid order status.'});db.prepare('UPDATE orders SET status=? WHERE id=?').run(req.body.status,req.params.id);res.json({ok:true});});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Nook Market is ready at http://localhost:${PORT}`));
