# Nook Market

A responsive full-stack storefront with its own brand, catalog, customer accounts, checkout, order tracking, reviews, coupons, and an admin area. The app uses Express, SQLite, and plain browser JavaScript, so there is no separate frontend build step.

## Run locally on Windows

1. Install **Node.js 20 or later (LTS recommended)** from [nodejs.org](https://nodejs.org/). The installer includes npm.
2. Open PowerShell in this project folder.
3. Install dependencies:

   ```powershell
   npm install
   ```

4. Start the app:

   ```powershell
   npm start
   ```

5. Open [http://localhost:3000](http://localhost:3000).

The first launch creates `data/nook-market.db` and seeds the catalog and demo admin. To stop the server, press **Ctrl+C** in PowerShell. The SQLite file holds your local changes across restarts.

### Demo administrator

- Email: `admin@nook.local`
- Password: `NookAdmin123!`

Create a customer account through **Account**. The seeded coupon `WELCOME10` takes 10% off at checkout.

## File structure

```text
nook-market/
├── data/                    # Created on first run; SQLite database (not committed)
├── public/
│   ├── app.js                # Storefront, cart, checkout, account, admin interactions
│   ├── index.html            # Shared app shell and footer
│   └── styles.css            # Responsive visual design and page styles
├── .gitignore
├── package.json              # Scripts and server dependencies
├── README.md                 # Setup and usage guide
└── server.js                 # Express API, SQLite schema, seed data, authentication
```

## What's included

- Searchable and filterable category catalog; featured and latest products; product detail, stock, and customer reviews.
- Persistent shopping bag, sign up/sign in/out, customer account and order history.
- Delivery and payment selection, order review/confirmation, coupon validation, and stock reduction during checkout.
- Admin sales summary, product create/edit/delete and inventory, category creation, coupon creation, and order status updates.
- SQLite tables for users, products, categories, orders and their items, reviews, and coupons.

Payment choices are a local demo flow; no card is charged. Before deploying publicly, set `JWT_SECRET` to a long random secret and replace the demo admin password. Product photos are loaded from Unsplash, so the browser needs internet access for those images and the optional Google Fonts.
