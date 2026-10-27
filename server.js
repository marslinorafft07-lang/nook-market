const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'replace-this-secret-before-deploying';
const dataDir = path.join(__dirname, 'data');
const egyptLocations = require('./data/egypt-locations.json');
const governoratesById = new Map(egyptLocations.governorates.map(item=>[item.id,item]));
const districtsById = new Map(egyptLocations.districts.map(item=>[item.id,item]));
const localitiesById = new Map(egyptLocations.localities.map(item=>[item.id,item]));
const paymentProofDir = path.join(dataDir, 'payment-proofs');
const returnProofDir = path.join(dataDir, 'return-proofs');
fs.mkdirSync(paymentProofDir, { recursive: true });
fs.mkdirSync(returnProofDir, { recursive: true });
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
CREATE TABLE IF NOT EXISTS return_requests (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), order_item_id INTEGER NOT NULL REFERENCES order_items(id), user_id INTEGER NOT NULL REFERENCES users(id), reason_type TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', photo_file TEXT, photo_unavailable INTEGER NOT NULL DEFAULT 0, delivery_date_unknown INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', admin_note TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
const returnColumns=db.prepare('PRAGMA table_info(return_requests)').all().map(column=>column.name);
if(!returnColumns.includes('photo_unavailable')) db.exec('ALTER TABLE return_requests ADD COLUMN photo_unavailable INTEGER NOT NULL DEFAULT 0');
if(!returnColumns.includes('delivery_date_unknown')) db.exec('ALTER TABLE return_requests ADD COLUMN delivery_date_unknown INTEGER NOT NULL DEFAULT 0');
const orderColumns=db.prepare('PRAGMA table_info(orders)').all().map(column=>column.name);
if(!orderColumns.includes('delivered_at')) db.exec('ALTER TABLE orders ADD COLUMN delivered_at TEXT');
if(!orderColumns.includes('phone')) db.exec('ALTER TABLE orders ADD COLUMN phone TEXT');
if(!orderColumns.includes('payment_proof')) db.exec('ALTER TABLE orders ADD COLUMN payment_proof TEXT');
if(!orderColumns.includes('governorate')) db.exec('ALTER TABLE orders ADD COLUMN governorate TEXT');
if(!orderColumns.includes('district')) db.exec('ALTER TABLE orders ADD COLUMN district TEXT');
if(!orderColumns.includes('locality')) db.exec('ALTER TABLE orders ADD COLUMN locality TEXT');
if(!orderColumns.includes('shipping_fee')) db.exec('ALTER TABLE orders ADD COLUMN shipping_fee REAL NOT NULL DEFAULT 0');
const productColumns=db.prepare('PRAGMA table_info(products)').all().map(column=>column.name);
if(!productColumns.includes('name_ar')) db.exec('ALTER TABLE products ADD COLUMN name_ar TEXT');
if(!productColumns.includes('description_ar')) db.exec('ALTER TABLE products ADD COLUMN description_ar TEXT');
const categoryColumns=db.prepare('PRAGMA table_info(categories)').all().map(column=>column.name);
if(!categoryColumns.includes('name_ar')) db.exec('ALTER TABLE categories ADD COLUMN name_ar TEXT');
const categories = [
  ['Home & Living','home','⌂','المنزل والمعيشة'], ['Laptop Accessories','Laptop Accessories','◉','إكسسوارات اللابتوب'], ['fashion','fashion','◇','الأزياء'], ['watch','watch','✳','الساعات'], ['Audio & Headphones','Audio & Headphones','♨','الصوت والسماعات']
];
const addCat = db.prepare('INSERT OR IGNORE INTO categories(name,slug,icon,name_ar) VALUES(?,?,?,?)');
categories.forEach(c => addCat.run(...c));
for(const [slug,nameAr] of categories.map(([,slug,,nameAr])=>[slug,nameAr])) db.prepare('UPDATE categories SET name_ar=? WHERE slug=? AND (name_ar IS NULL OR name_ar=\'\')').run(nameAr,slug);
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
const arabicProducts = [
  [1,'ورق وملصقات حرارية للطابعة الصغيرة','ورق حراري ذاتي اللصق للطباعة بدون حبر، مناسب للصور والاستخدام في المنزل والمدرسة والمكتب.'],
  [2,'حامل لابتوب قابل للطي والتعديل','حامل محمول قابل للتعديل يساعد على رفع اللابتوب وتحسين وضعية الاستخدام والتهوية.'],
  [3,'موزّع USB-C ‏8 في 1 مع منفذ صوت','موزّع متعدد الاستخدامات يضيف منافذ USB-C وUSB ومنفذًا صوتيًا للأجهزة اللوحية وغيرها.'],
  [4,'شمعة صويا معطرة بالأرز والبرغموت','شمعة صويا مصبوبة يدويًا برائحة الأرز والبرغموت، بمدة احتراق تصل إلى 45 ساعة.'],
  [5,'طقم أكواب خزفية بتصميم انسيابي','أربعة أكواب خزفية بتصميم مريح ولمعة منقطة ناعمة، آمنة للاستخدام في غسالة الأطباق.'],
  [6,'كرسي استرخاء بإطار خشب طبيعي','كرسي مريح بإطار من خشب الدردار وقماش ذي ملمس طبيعي، مناسب للاسترخاء اليومي.'],
  [7,'كاميرا أفلام صغيرة','كاميرا سهلة الاستخدام بفلاش مدمج لالتقاط صور عفوية وذكريات جميلة.'],
  [8,'قميص كتان خفيف لعطلة نهاية الأسبوع','قميص مريح وقابل للتنفس من الكتان الأوروبي، مناسب للارتداء اليومي.'],
  [9,'دفتر يوميات وملاحظات','دفتر بورق معاد تدويره وتجليد مسطح، يضم 160 صفحة لتدوين الملاحظات اليومية.'],
  [10,'قاعدة توصيل USB-C متعددة المنافذ','قاعدة توصيل خفيفة تضم منافذ USB 2.0 وUSB 3.0، مناسبة للحواسيب والأجهزة اللوحية والهواتف.']
];
const updateArabicProduct=db.prepare('UPDATE products SET name_ar=?,description_ar=? WHERE id=? AND (name_ar IS NULL OR name_ar=\'\')');
for(const [id,nameAr,descriptionAr] of arabicProducts) updateArabicProduct.run(nameAr,descriptionAr,id);
db.prepare("UPDATE products SET name='Cedar & Bergamot Soy Candle' WHERE id=4 AND name=''").run();
db.prepare("UPDATE products SET description='A compact multi-port USB-C docking station for computers, tablets and phones.' WHERE id=10 AND description LIKE 'A calm place to collect%'").run();

// Curated Egypt-marketplace additions. Supplier costs stay in the private sourcing note,
// not in the customer-facing catalogue. Name-based checks make deploy-time seeding safe.
const sourcedProducts = [
  ['START ST-708 Type-C Earphones','سماعة START سلكية بمنفذ Type-C','Audio & Headphones',219,'Wired in-ear stereo earphones with a built-in microphone and a 1.2 m cable.','سماعة أذن سلكية بصوت ستيريو وميكروفون مدمج وكابل بطول 1.2 متر.','https://f.nooncdn.com/p/75d7bbf8c6265e799f6b9c8968e9df95%7Cpzsku/ZFD0D18DC814C03FFD6FAZ/45/1771206272/9460304d-4a86-4a86-9cdb-b6f760ce8c6e.jpg'],
  ['START TWS 03F Wireless Earbuds','سماعات START لاسلكية TWS 03F','Audio & Headphones',749,'Bluetooth earbuds with touch controls and a charging case that can recharge the earbuds several times.','سماعات بلوتوث بتحكم باللمس وعلبة شحن يمكنها إعادة شحن السماعتين عدة مرات.','https://f.nooncdn.com/p/pzsku/Z7A6CB204B92CFA8747C9Z/45/1751300730/75962996-4c38-4653-bb12-84267e6f2106.jpg'],
  ['START ST-116 Bluetooth Neckband Earphones','سماعة بلوتوث رياضية برقبة START ST-116','Audio & Headphones',469,'Lightweight Bluetooth neckband earphones with a built-in microphone for calls, music and workouts.','سماعة بلوتوث خفيفة بتصميم حول الرقبة وميكروفون للمكالمات والموسيقى والرياضة.','https://f.nooncdn.com/p/75d7bbf8c6265e799f6b9c8968e9df95%7Cpzsku/Z55F866FEB47A63B1D8EFZ/45/1768668810/ec841474-c20b-401b-9ed7-26c10fd8a286.jpg'],
  ['START ST-256 Over-Ear Headphones','سماعة رأس START ST-256 فوق الأذن','Audio & Headphones',799,'Adjustable over-ear stereo headset for music and calls, with a foldable headband.','سماعة رأس ستيريو قابلة لضبط المقاس، مناسبة للموسيقى والمكالمات وسهلة الطي.','https://f.nooncdn.com/p/75d7bbf8c6265e799f6b9c8968e9df95%7Cpzsku/Z44826961C28423833E21Z/45/1770856379/a3776244-1563-4c2d-a07c-1fcbf789a28e.jpg'],
  ['START 3.5 mm AUX Audio Cable 1 m','كابل صوت AUX من START بطول متر','Audio & Headphones',129,'A 1 m stereo AUX cable with 3.5 mm male connectors for compatible phones, speakers and car stereos.','كابل صوت AUX ستيريو بطول متر وموصل 3.5 مم للأجهزة والسماعات وأنظمة صوت السيارة المتوافقة.','https://f.nooncdn.com/p/pzsku/Z9CC2ABD44ECC8B70023FZ/45/1756056640/0167c34b-15c9-4415-a920-b3dc2dc3408d.jpg'],
  ['Foldable Aluminum Laptop Stand','حامل لابتوب ألومنيوم قابل للطي','Laptop Accessories',239,'Foldable aluminum laptop and tablet stand with adjustable viewing height, anti-slip pads and a carry pouch.','حامل ألومنيوم قابل للطي للابتوب والتابلت، بارتفاع قابل للتعديل ووسادات مانعة للانزلاق وحقيبة حفظ.','https://f.nooncdn.com/p/pzsku/Z75C9712BA02538715B20Z/45/1762681285/b1aad6ff-a7e1-4890-8214-2403f2dfb368.jpg'],
  ['8-in-1 USB-C Hub with Ethernet','موزّع USB-C ‏8 في 1 مع منفذ شبكة','Laptop Accessories',679,'USB-C hub with HDMI, Ethernet, USB 3.0, SD/TF card readers and up to 100 W power delivery. Device USB-C ports must support video output for HDMI use.','موزّع USB-C يضم HDMI وشبكة Ethernet وUSB 3.0 وقارئَي SD وTF وشحنًا حتى 100 واط. يلزم دعم منفذ الجهاز لعرض الفيديو لاستخدام HDMI.','https://f.nooncdn.com/p/pzsku/Z11D702AAFFA60C9796DBZ/45/1751201805/b4dca7f4-5f14-4a4e-b4e6-d642cb090afa.jpg'],
  ['START 10,000 mAh Power Bank with 3 Cables','باور بانك START بسعة 10,000 مللي أمبير و3 كابلات','Laptop Accessories',749,'Portable 10,000 mAh power bank with three built-in charging cables for compatible phones.','باور بانك محمول بسعة 10,000 مللي أمبير وثلاثة كابلات شحن مدمجة للهواتف المتوافقة.','https://f.nooncdn.com/p/pzsku/ZDFDA26910B8FD898A241Z/45/_/1738717489/0c3ded93-7531-49e4-9d26-359a109c1f60.jpg'],
  ['Fekra Sticky Suction Phone Grip','حامل ومقبض هاتف لاصق بالشفط من Fekra','Laptop Accessories',119,'Reusable silicone suction grip for hands-free viewing, selfies and video calls on smooth surfaces.','مقبض سيليكون قابل لإعادة الاستخدام لتثبيت الهاتف ومشاهدة الفيديو أو إجراء المكالمات على الأسطح الملساء.','https://i5.walmartimages.com/seo/KKFEN-Silicone-Double-Sided-Suction-Cup-Phone-Case-Detachable-Mount-Sticky-Phone-Grip-Hands-Free-Accessories-Selfies-Videos-Trending-TikTok-Items-iPh_3bd4a8a7-a5a2-4844-b3a3-94eef2058dbf.701f79b4caecd0bf8c187986d6403624.jpeg'],
  ['Adjustable Foldable Phone Stand','حامل هاتف مكتبي قابل للتعديل والطي','Laptop Accessories',109,'Compact adjustable desktop stand for compatible smartphones and small tablets.','حامل مكتبي صغير قابل للتعديل للهواتف الذكية والأجهزة اللوحية الصغيرة المتوافقة.','https://down-mx.img.susercontent.com/file/f7cede9b94872f251c96e18b9e923afa'],
  ['START 2 m USB-to-Micro USB Cable','كابل START بطول مترين USB إلى Micro USB','Laptop Accessories',139,'A 2 m USB-to-Micro USB charging and data cable rated up to 25 W/3 A, subject to device compatibility.','كابل شحن ونقل بيانات USB إلى Micro USB بطول مترين، حتى 25 واط/3 أمبير بحسب توافق الجهاز.','https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=900&q=85'],
  ['Rechargeable Wireless LED Table Lamp','مصباح طاولة LED لاسلكي قابل لإعادة الشحن','home',369,'Portable rechargeable table lamp with adjustable brightness and three light tones for a desk or bedside table.','مصباح طاولة محمول قابل لإعادة الشحن، بدرجة إضاءة قابلة للتعديل وثلاثة ألوان للضوء، مناسب للمكتب أو بجانب السرير.','https://f.nooncdn.com/p/pzsku/Z3B8EB12E69BC9C250851Z/45/_/1772613168/b86daadd-7c4e-4478-8c20-d738746b3e65.jpg'],
  ['White Desk Lamp with USB Charging Port','مصباح مكتب أبيض بمنفذ USB','home',399,'Compact white desk lamp with a 34 cm length and USB charging port.','مصباح مكتب أبيض صغير بطول 34 سم ومنفذ USB للشحن.','https://f.nooncdn.com/p/v1576763809/N32565664A_1.jpg'],
  ['Beige Wooden Desk Organizer','منظّم مكتب خشبي بلون بيج','home',489,'Desktop organizer with compartments for pens, notes, clips and small office accessories.','منظّم مكتبي بخانات للأقلام والملاحظات والدبابيس والإكسسوارات المكتبية الصغيرة.','https://f.nooncdn.com/p/pzsku/Z34F6E367B37CE62B76F7Z/45/1746439459/1f3d2e6f-3dba-422c-80c0-4f43661810b8.jpg'],
  ['KITCHENOO 8-Piece Drawer Organizer Set','طقم KITCHENOO لتنظيم الأدراج من 8 قطع','home',309,'Eight clear drawer trays in multiple sizes for organizing makeup, kitchen utensils or office supplies.','ثماني علب شفافة بأحجام متعددة لتنظيم المكياج أو أدوات المطبخ أو مستلزمات المكتب.','https://f.nooncdn.com/p/pzsku/Z3C55884925E074CF509EZ/45/1760562036/919e2702-9bab-47b8-aa63-64df2d9c8d59.jpg'],
  ['Vtopmart Clear Drawer Organizer Set','طقم Vtopmart شفاف لتنظيم الأدراج','home',259,'Clear modular storage trays help sort small items in bedroom, bathroom, kitchen or office drawers.','علب تخزين شفافة تساعد على ترتيب الأغراض الصغيرة في أدراج غرفة النوم أو الحمام أو المطبخ أو المكتب.','https://m.media-amazon.com/images/I/817lL7Apv%2BL.jpg'],
  ['Wooden Desk Organizer with Drawer','منظّم مكتب خشبي بدرج','home',479,'Wooden desktop organizer with multiple upright compartments, a flat storage space and a small drawer.','منظّم مكتبي خشبي بخانات متعددة وحيّز مسطح ودرج صغير لحفظ المستلزمات.','https://f.nooncdn.com/p/pzsku/Z9E20F151B77C1595DF73Z/45/1767807994/f51c6473-b1e2-45aa-8c53-dba420df803b.jpg'],
  ['Quartz Watch and Bracelet Set','ساعة كوارتز نسائية مع أساور','watch',359,'A minimalist quartz wristwatch with a matching bracelet set for everyday wear or gifting.','ساعة كوارتز بتصميم بسيط مع أساور متناسقة، مناسبة للاستخدام اليومي أو كهدية.','https://media.kohlsimg.com/is/image/kohls/7942800?hei=1000&op_sharpen=1&wid=1000'],
  ['Six-Slot Watch Display Box','علبة عرض وحفظ ساعات بست خانات','watch',329,'Six padded watch compartments under a clear display lid to keep a watch collection organized.','علبة بست خانات مبطنة لحفظ الساعات وتنظيمها مع غطاء شفاف لعرض المحتويات.','https://www.bigw.com.au/medias/sys_master/images/images/h9f/hee/116654953496606.jpg']
];
const insertSourcedProduct=db.prepare('INSERT INTO products(name,name_ar,category_id,price,compare_price,description,description_ar,image,stock,featured) VALUES(?,?,?,?,?,?,?,?,?,?)');
const sourcedProductExists=db.prepare('SELECT 1 FROM products WHERE name=?');
const seedSourcedProducts=db.transaction(()=>{for(const [name,nameAr,slug,price,description,descriptionAr,image] of sourcedProducts){if(!sourcedProductExists.get(name))insertSourcedProduct.run(name,nameAr,catId(slug),price,null,description,descriptionAr,image,0,0);}});
seedSourcedProducts();
db.prepare('INSERT OR IGNORE INTO coupons(code,discount) VALUES(?,?)').run('WELCOME10',10)
if (!db.prepare('SELECT 1 FROM users WHERE email=?').get('admin@nook.local')) {
  db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run('Nook Admin','admin@nook.local',bcrypt.hashSync('Nk7$mPx92!vQeR',10),'admin');
}

app.use(express.json({limit: '8mb'}));
app.use(express.static(path.join(__dirname, 'public')));
const auth = (req,res,next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  try { req.user = jwt.verify(token, SECRET); next(); } catch { res.status(401).json({error:'Please sign in to continue.'}); }
};
const admin = (req,res,next) => req.user?.role === 'admin' ? next() : res.status(403).json({error:'Admin access required.'});
const productsQuery = `SELECT p.*, c.name category, c.name_ar category_ar, c.slug category_slug, COALESCE(ROUND(AVG(r.rating),1),0) rating, COUNT(r.id) review_count FROM products p JOIN categories c ON c.id=p.category_id LEFT JOIN reviews r ON r.product_id=p.id`;
app.get('/api/locations',(req,res)=>res.json(egyptLocations));
app.get('/api/categories', (req,res) => res.json(db.prepare('SELECT * FROM categories ORDER BY name').all()));
app.get('/api/products', (req,res) => {
  let sql = productsQuery + ' WHERE 1=1', args=[];
  if (req.query.category) { sql += ' AND c.slug=?'; args.push(req.query.category); }
  if (req.query.search) { sql += ' AND (p.name LIKE ? OR p.description LIKE ? OR p.name_ar LIKE ? OR p.description_ar LIKE ?)'; args.push(`%${req.query.search}%`,`%${req.query.search}%`,`%${req.query.search}%`,`%${req.query.search}%`); }
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
  const rows = req.user.role==='admin' ? db.prepare('SELECT o.*,u.email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC').all() : db.prepare("SELECT * FROM orders WHERE user_id=? AND status!='cancelled' ORDER BY id DESC").all(req.user.id);
  res.json(rows.map(o=>({...o,items:db.prepare('SELECT oi.*,p.name_ar FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?').all(o.id),return_requests:db.prepare('SELECT id,order_item_id,reason_type,details,status,admin_note,created_at,updated_at,photo_file IS NOT NULL AS has_photo FROM return_requests WHERE order_id=? AND user_id=? ORDER BY id DESC').all(o.id,req.user.id)})));
});
app.post('/api/orders/:id/returns',auth,(req,res)=>{
  const order=db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(Number(req.params.id),req.user.id);
  if(!order)return res.status(404).json({error:'Order not found.'});
  if(order.status!=='delivered')return res.status(400).json({error:'Return requests are available after delivery.'});
  const {orderItemId,reasonType,details='',photo,photoUnavailable=false}=req.body||{};
  if(!['change_of_mind','defective','wrong_item'].includes(reasonType))return res.status(400).json({error:'Choose a return reason.'});
  const item=db.prepare('SELECT id FROM order_items WHERE id=? AND order_id=?').get(Number(orderItemId),order.id);
  if(!item)return res.status(400).json({error:'Choose a product from this order.'});
  const cleanDetails=typeof details==='string'?details.trim().slice(0,2000):'';
  if(reasonType!=='change_of_mind'&&!cleanDetails)return res.status(400).json({error:'Describe the issue with the product.'});
  const active=db.prepare("SELECT id FROM return_requests WHERE order_item_id=? AND status NOT IN ('rejected','cancelled')").get(item.id);
  if(active)return res.status(409).json({error:'A return request for this product is already under review.'});
  if(order.delivered_at){
    const deliveredAt=Date.parse(order.delivered_at.replace(' ','T')+'Z');
    const days=reasonType==='change_of_mind'?14:30;
    if(Number.isFinite(deliveredAt)&&Date.now()>deliveredAt+days*86400000)return res.status(400).json({error:`The ${days}-day return request period has passed.`});
  }
  let filename=null;
  if(photo){
    const match=typeof photo==='string'&&photo.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if(!match)return res.status(400).json({error:'Choose a PNG, JPG or WEBP image.'});
    const image=Buffer.from(match[2],'base64');
    if(!image.length||image.length>5*1024*1024)return res.status(400).json({error:'The image must be smaller than 5 MB.'});
    const validImage=match[1]==='image/png'?image.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):match[1]==='image/jpeg'?image[0]===0xff&&image[1]===0xd8&&image[2]===0xff:image.toString('ascii',0,4)==='RIFF'&&image.toString('ascii',8,12)==='WEBP';
    if(!validImage)return res.status(400).json({error:'The selected file is not a valid image.'});
    filename=crypto.randomUUID()+'.'+({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[match[1]]);
    try{fs.writeFileSync(path.join(returnProofDir,filename),image,{flag:'wx'});}catch{return res.status(500).json({error:'Could not save the image.'});}
  }
  if(reasonType!=='change_of_mind'&&!filename&&!photoUnavailable)return res.status(400).json({error:'Attach a photo, or choose that you cannot upload one.'});
  try{
    const result=db.prepare('INSERT INTO return_requests(order_id,order_item_id,user_id,reason_type,details,photo_file,photo_unavailable,delivery_date_unknown) VALUES(?,?,?,?,?,?,?,?)').run(order.id,item.id,req.user.id,reasonType,cleanDetails,filename,photoUnavailable?1:0,order.delivered_at?0:1);
    res.status(201).json({ok:true,id:Number(result.lastInsertRowid)});
  }catch(e){if(filename)fs.rmSync(path.join(returnProofDir,filename),{force:true});res.status(400).json({error:'Could not submit the return request.'});}
});
app.post('/api/orders/:id/cancel',auth,(req,res)=>{
  const cancel=db.transaction(()=>{
    const order=db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
    if(!order)throw new Error('Order not found.');
    if(!['pending','confirmed'].includes(order.status))throw new Error('Only pending or confirmed orders can be cancelled.');
    const changed=db.prepare("UPDATE orders SET status='cancelled' WHERE id=? AND status=?").run(order.id,order.status);
    if(!changed.changes)throw new Error('The order status changed. Refresh and try again.');
    const items=db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(order.id);
    for(const item of items)db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(item.quantity,item.product_id);
  });
  try{cancel();res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}
});
app.post('/api/orders/:id/payment-proof',auth,(req,res)=>{
  const order=db.prepare('SELECT id,status,payment_method,payment_proof FROM orders WHERE id=? AND user_id=?').get(Number(req.params.id),req.user.id);
  if(!order)return res.status(404).json({error:'Order not found.'});
  if(order.status!=='pending'||!['InstaPay','إنستاباي','Vodafone Cash','فودافون كاش'].includes(order.payment_method))return res.status(400).json({error:'A transfer screenshot can only be added to a pending bank or wallet transfer order.'});
  const {paymentProof}=req.body||{};
  const match=typeof paymentProof==='string'&&paymentProof.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match)return res.status(400).json({error:'Choose a PNG, JPG or WEBP transfer screenshot.'});
  const image=Buffer.from(match[2],'base64');
  if(!image.length||image.length>5*1024*1024)return res.status(400).json({error:'The transfer screenshot must be smaller than 5 MB.'});
  const validImage=match[1]==='image/png'?image.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):match[1]==='image/jpeg'?image[0]===0xff&&image[1]===0xd8&&image[2]===0xff:image.toString('ascii',0,4)==='RIFF'&&image.toString('ascii',8,12)==='WEBP';
  if(!validImage)return res.status(400).json({error:'The selected file is not a valid image.'});
  const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[match[1]],filename=crypto.randomUUID()+'.'+extension;
  try{
    fs.writeFileSync(path.join(paymentProofDir,filename),image,{flag:'wx'});
    db.prepare('UPDATE orders SET payment_proof=? WHERE id=? AND user_id=? AND status=\'pending\'').run(filename,order.id,req.user.id);
    if(order.payment_proof)fs.rmSync(path.join(paymentProofDir,path.basename(order.payment_proof)),{force:true});
    res.json({ok:true});
  }catch(e){fs.rmSync(path.join(paymentProofDir,filename),{force:true});res.status(400).json({error:'Could not save the transfer screenshot.'});}
});
app.post('/api/orders',auth,(req,res)=>{
  const {items,name,address,phone,paymentMethod,coupon,paymentProof,governorateId,districtId,localityId,localityManual}=req.body||{};
  const governorate=governoratesById.get(governorateId),district=districtsById.get(districtId),locality=localitiesById.get(localityId),manualLocality=localityId==='__manual__'&&typeof localityManual==='string'?localityManual.trim():'';
  if (!Array.isArray(items)||!items.length||!name||!address||!phone||!governorate||!district||district.parentId!==governorate.id||!(locality?.parentId===district.id||(localityId==='__manual__'&&manualLocality.length>=2))||!['Cash on delivery','InstaPay','Vodafone Cash'].includes(paymentMethod)) return res.status(400).json({error:'Complete your delivery and payment details.'});
  const shippingFee=governorate.shippingFee;
  if(['InstaPay','Vodafone Cash'].includes(paymentMethod)&&!paymentProof)return res.status(400).json({error:'Upload your transfer screenshot.'});
  let proofFile=null;
  if(['InstaPay','Vodafone Cash'].includes(paymentMethod)){
    const match=typeof paymentProof==='string'&&paymentProof.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if(!match)return res.status(400).json({error:'Choose a PNG, JPG or WEBP transfer screenshot.'});
    const image=Buffer.from(match[2],'base64');
    if(!image.length||image.length>5*1024*1024)return res.status(400).json({error:'The transfer screenshot must be smaller than 5 MB.'});
    const validImage=match[1]==='image/png'?image.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):match[1]==='image/jpeg'?image[0]===0xff&&image[1]===0xd8&&image[2]===0xff:image.toString('ascii',0,4)==='RIFF'&&image.toString('ascii',8,12)==='WEBP';
    if(!validImage)return res.status(400).json({error:'The selected file is not a valid image.'});
    const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[match[1]];
    proofFile=crypto.randomUUID()+'.'+extension;
    fs.writeFileSync(path.join(paymentProofDir,proofFile),image,{flag:'wx'});
  }
  const create=db.transaction(()=>{
    let total=0, selected=[];
    for(const item of items){const p=db.prepare('SELECT * FROM products WHERE id=?').get(Number(item.id)); const qty=Number(item.quantity); if(!p||!Number.isInteger(qty)||qty<1||qty>p.stock) throw new Error(`EGP{p?.name||'A product'} does not have enough stock.`); total+=p.price*qty; selected.push({p,qty});}
    if(coupon){const valid=db.prepare('SELECT * FROM coupons WHERE upper(code)=upper(?) AND active=1').get(coupon);if(!valid)throw new Error('That coupon is no longer active.');total=total*(1-valid.discount/100);db.prepare('UPDATE coupons SET uses=uses+1 WHERE id=?').run(valid.id);}total+=shippingFee;if(paymentMethod==='Cash on delivery')total+=20;
   const o=db.prepare('INSERT INTO orders(user_id,total,customer_name,address,phone,payment_method,payment_proof,governorate,district,locality,shipping_fee) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(req.user.id,total,name,address,phone,paymentMethod,proofFile,governorate.ar,district.ar,locality?.ar||manualLocality,shippingFee);
    for(const {p,qty} of selected){db.prepare('INSERT INTO order_items(order_id,product_id,name,price,quantity) VALUES(?,?,?,?,?)').run(o.lastInsertRowid,p.id,p.name,p.price,qty);db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(qty,p.id);}
    return Number(o.lastInsertRowid);
  });
  try {res.status(201).json(db.prepare('SELECT * FROM orders WHERE id=?').get(create()));} catch(e){if(proofFile)fs.rmSync(path.join(paymentProofDir,proofFile),{force:true});res.status(400).json({error:e.message});}
});
app.get('/api/admin/orders/:id/payment-proof',auth,admin,(req,res)=>{
  const order=db.prepare('SELECT payment_proof FROM orders WHERE id=?').get(Number(req.params.id));
  if(!order?.payment_proof)return res.status(404).json({error:'Payment screenshot not found.'});
  const filename=path.basename(order.payment_proof),filepath=path.join(paymentProofDir,filename);
  if(!fs.existsSync(filepath))return res.status(404).json({error:'Payment screenshot file is missing.'});
  res.type(path.extname(filename)).sendFile(filepath);
});
app.get('/api/admin/returns',auth,admin,(req,res)=>{
  res.json(db.prepare(`SELECT r.*,o.customer_name,o.phone,o.payment_method,o.delivered_at,oi.name AS product_name,oi.quantity,oi.price,u.email FROM return_requests r JOIN orders o ON o.id=r.order_id JOIN order_items oi ON oi.id=r.order_item_id JOIN users u ON u.id=r.user_id ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,r.id DESC`).all().map(({photo_file,...row})=>({...row,has_photo:Boolean(photo_file)})));
});
app.get('/api/admin/returns/:id/photo',auth,admin,(req,res)=>{
  const request=db.prepare('SELECT photo_file FROM return_requests WHERE id=?').get(Number(req.params.id));
  if(!request?.photo_file)return res.status(404).json({error:'Return photo not found.'});
  const filename=path.basename(request.photo_file),filepath=path.join(returnProofDir,filename);
  if(!fs.existsSync(filepath))return res.status(404).json({error:'Return photo file is missing.'});
  res.type(path.extname(filename)).sendFile(filepath);
});
app.patch('/api/admin/returns/:id',auth,admin,(req,res)=>{
  const allowed=['pending','reviewing','approved','rejected','received','refunded','cancelled'];
  const {status,admin_note=''}=req.body||{};
  if(!allowed.includes(status))return res.status(400).json({error:'Choose a valid return status.'});
  const result=db.prepare('UPDATE return_requests SET status=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,String(admin_note).trim().slice(0,2000),Number(req.params.id));
  if(!result.changes)return res.status(404).json({error:'Return request not found.'});
  res.json({ok:true});
});
app.get('/api/coupons/:code',(req,res)=>{const c=db.prepare('SELECT * FROM coupons WHERE upper(code)=upper(?) AND active=1').get(req.params.code); c?res.json(c):res.status(404).json({error:'That code is not active.'});});
app.post('/api/reviews',auth,(req,res)=>{const {productId,rating,comment}=req.body||{};if(!Number.isInteger(rating)||rating<1||rating>5||!comment?.trim())return res.status(400).json({error:'Add a rating and a short review.'});db.prepare('INSERT INTO reviews(user_id,product_id,rating,comment) VALUES(?,?,?,?)').run(req.user.id,productId,rating,comment.trim());res.status(201).json({ok:true});});
app.get('/api/admin/analytics',auth,admin,(req,res)=>{
  res.json({revenue:db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status!='cancelled'").get().n,orders:db.prepare('SELECT COUNT(*) n FROM orders').get().n,products:db.prepare('SELECT COUNT(*) n FROM products').get().n,customers:db.prepare("SELECT COUNT(*) n FROM users WHERE role='customer'").get().n,recent:db.prepare('SELECT o.*,u.name FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 6').all()});
});
app.post('/api/admin/products',auth,admin,(req,res)=>{const {name,name_ar,category_id,price,compare_price,description,description_ar,image,stock}=req.body;if(!name?.trim()||!name_ar?.trim()||!description?.trim()||!description_ar?.trim())return res.status(400).json({error:'Enter the product name and description in English and Arabic.'});try{const result=db.prepare('INSERT INTO products(name,name_ar,category_id,price,compare_price,description,description_ar,image,stock) VALUES(?,?,?,?,?,?,?,?,?)').run(name.trim(),name_ar.trim(),category_id,price,compare_price||null,description.trim(),description_ar.trim(),image,stock);res.status(201).json({id:result.lastInsertRowid});}catch(e){res.status(400).json({error:'Check all product fields and try again.'});}});
app.put('/api/admin/products/:id',auth,admin,(req,res)=>{const {name,name_ar,category_id,price,compare_price,description,description_ar,image,stock}=req.body;if(!name?.trim()||!name_ar?.trim()||!description?.trim()||!description_ar?.trim())return res.status(400).json({error:'Enter the product name and description in English and Arabic.'});try{db.prepare('UPDATE products SET name=?,name_ar=?,category_id=?,price=?,compare_price=?,description=?,description_ar=?,image=?,stock=? WHERE id=?').run(name.trim(),name_ar.trim(),category_id,price,compare_price||null,description.trim(),description_ar.trim(),image,stock,req.params.id);res.json({ok:true});}catch(e){res.status(400).json({error:'Check all product fields and try again.'});}});
app.delete('/api/admin/products/:id',auth,admin,(req,res)=>{db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);res.json({ok:true});});
app.post('/api/admin/categories',auth,admin,(req,res)=>{const {name,name_ar,icon='✳'}=req.body;try{const slug=name.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');db.prepare('INSERT INTO categories(name,slug,icon,name_ar) VALUES(?,?,?,?)').run(name,slug,icon,name_ar||'');res.json({ok:true});}catch(e){res.status(400).json({error:'Category name already exists.'});}});
app.post('/api/admin/coupons',auth,admin,(req,res)=>{const {code,discount}=req.body;try{db.prepare('INSERT INTO coupons(code,discount) VALUES(?,?)').run(code.toUpperCase(),discount);res.json({ok:true});}catch(e){res.status(400).json({error:'Coupon code already exists.'});}});
app.patch('/api/admin/orders/:id',auth,admin,(req,res)=>{const allowed=['pending','confirmed','shipped','delivered','cancelled'];if(!allowed.includes(req.body.status))return res.status(400).json({error:'Invalid order status.'});try{db.transaction(()=>{const order=db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);if(!order)throw new Error('Order not found.');if(order.status==='cancelled'&&req.body.status!=='cancelled')throw new Error('Cancelled orders cannot be reopened.');if(req.body.status==='cancelled'&&order.status!=='cancelled'){const items=db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(order.id);for(const item of items)db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(item.quantity,item.product_id);}db.prepare("UPDATE orders SET status=?,delivered_at=CASE WHEN ?='delivered' AND status!='delivered' THEN CURRENT_TIMESTAMP WHEN ?!='delivered' THEN NULL ELSE delivered_at END WHERE id=?").run(req.body.status,req.body.status,req.body.status,req.params.id);})();res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Nook Market is ready at http://localhost:${PORT}`));
