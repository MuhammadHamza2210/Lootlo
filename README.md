---
title: LootLo
emoji: 🛒
colorFrom: purple
colorTo: pink
sdk: docker
app_port: 7860
pinned: false
---

# 🛒 LootLo — Premium Online Shopping

> 🔴 **Live demo:** **https://muhammadhamza221003-lootlo.hf.space**
> (admin login — `lootlo@gmail.com` / `lootlo123`)

A full-stack e-commerce web app with a **Flask + SQLite** backend and a
**glassmorphism / aurora** UI. Everything (users, products, orders, reviews,
inventory…) is saved in `lootlo.db`, so your data survives restarts.

**Developer:** Muhammad Hamza · ✉ i.muhammadhamza2210@gmail.com

---

## ▶ How to run

**Easiest:** double-click **`Start LootLo.bat`** — it installs Flask (first time),
opens your browser, and starts the server.

**Or from a terminal / Spyder:**

```bash
pip install -r requirements.txt
python app.py
```

Then open **http://127.0.0.1:5000**

---

## 🔑 Logging in

When the site opens you land on the **gateway login screen** first.

| Role  | How |
|-------|-----|
| **User**  | Click **Register** to create an account, or **Login**. |
| **Admin** | Click the **Admin** tab. Default: `lootlo@gmail.com` / `lootlo123` |

---

## ✨ What's new in this version

**5 new features added:**
1. **Wishlist / Favorites** ❤️ — save products, dedicated wishlist page.
2. **Promo / coupon codes** — `LOOTLO10`, `HAMZA20`, `WELCOME15` (applied at cart/checkout).
3. **Dark / Light theme toggle** 🌙☀️ — remembered per browser.
4. **Live order tracking** — visual timeline (Placed → Confirmed → Shipped → Out for Delivery → Delivered); admin updates status.
5. **Live search suggestions** + sort (price / rating) + category filter.

**Plus:**
- Brand-new glassmorphism + animated aurora UI, pop-ups, toasts & confetti 🎉
- **SQLite persistence** — nothing is lost on restart.
- **Admin console**: add / edit / delete products, restock, inventory & low-stock
  alerts, stock-movement log, order management, reply to customer queries, live stats.
- Secure password hashing (werkzeug), product reviews & ratings, customer support.

---

## 🗂 Project structure

```
lootlo/
├── app.py                # Flask + SQLite backend (REST API + serves the site)
├── index.html            # UI shell + gateway login
├── style.css             # glassmorphism / aurora styles
├── app.js                # all frontend logic (talks to the API)
├── seed_products.json    # 45 starter products (seeded into DB on first run)
├── lootlo.db             # SQLite database (auto-created on first run)
├── images/               # product images
├── requirements.txt
├── Start LootLo.bat      # one-click launcher
└── _backup_old/          # your original localStorage version (kept safe)
```

> To reset everything to factory state, just delete `lootlo.db` and restart.
