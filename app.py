# -*- coding: utf-8 -*-
"""
LootLo - Premium Online Shopping
Flask + SQLite backend.

Developer : Muhammad Hamza
Email     : i.muhammadhamza2210@gmail.com

Run:
    python app.py
Then open http://127.0.0.1:5000 in your browser.
Everything (users, products, orders, reviews...) is stored in lootlo.db
so it survives restarts.
"""

import os
import json
import sqlite3
import secrets
from datetime import datetime, timedelta

from flask import Flask, request, jsonify, g, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "lootlo.db")
SEED_PATH = os.path.join(BASE_DIR, "seed_products.json")

# Seeded admin account (you can add more from the Admin panel later)
DEFAULT_ADMIN = {
    "name": "Muhammad Hamza",
    "email": "lootlo@gmail.com",
    "password": "lootlo123",
}

# Starter coupon codes
DEFAULT_COUPONS = [
    ("LOOTLO10", 10),
    ("HAMZA20", 20),
    ("WELCOME15", 15),
]

ORDER_STAGES = ["Placed", "Confirmed", "Shipped", "Out for Delivery", "Delivered"]

app = Flask(__name__, static_folder=None)


# --------------------------------------------------------------------------- #
#  Database helpers
# --------------------------------------------------------------------------- #
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    cur = db.cursor()
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            token TEXT,
            created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            brand TEXT,
            price REAL NOT NULL,
            category TEXT,
            image TEXT,
            description TEXT,
            stock INTEGER DEFAULT 0,
            reorder_level INTEGER DEFAULT 5,
            cost_price REAL DEFAULT 0,
            supplier TEXT,
            sku TEXT,
            created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            customer_name TEXT,
            total REAL,
            discount REAL DEFAULT 0,
            coupon TEXT,
            payment_method TEXT,
            address TEXT,
            city TEXT,
            phone TEXT,
            status TEXT DEFAULT 'Placed',
            created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER,
            product_id INTEGER,
            name TEXT,
            price REAL,
            qty INTEGER,
            image TEXT
        );

        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER,
            user_id INTEGER,
            user_name TEXT,
            rating INTEGER,
            text TEXT,
            verified INTEGER DEFAULT 0,
            created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS queries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            user_name TEXT,
            subject TEXT,
            product_id INTEGER,
            message TEXT,
            response TEXT,
            status TEXT DEFAULT 'Open',
            created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS stock_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER,
            change INTEGER,
            type TEXT,
            notes TEXT,
            created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS wishlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            product_id INTEGER,
            UNIQUE(user_id, product_id)
        );

        CREATE TABLE IF NOT EXISTS coupons (
            code TEXT PRIMARY KEY,
            discount INTEGER,
            active INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS deals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER,
            discount INTEGER,
            label TEXT,
            ends_at TEXT,
            created_at TEXT
        );
        """
    )
    db.commit()

    # Migrate: add 'verified' column to reviews on older databases
    try:
        cols = [r["name"] for r in cur.execute("PRAGMA table_info(reviews)").fetchall()]
        if "verified" not in cols:
            cur.execute("ALTER TABLE reviews ADD COLUMN verified INTEGER DEFAULT 0")
            db.commit()
    except Exception:
        pass

    # Seed admin
    cur.execute("SELECT COUNT(*) c FROM users WHERE role='admin'")
    if cur.fetchone()["c"] == 0:
        cur.execute(
            "INSERT INTO users (name,email,phone,password,role,created_at) VALUES (?,?,?,?,?,?)",
            (
                DEFAULT_ADMIN["name"],
                DEFAULT_ADMIN["email"],
                "",
                generate_password_hash(DEFAULT_ADMIN["password"]),
                "admin",
                now(),
            ),
        )

    # Seed coupons
    for code, disc in DEFAULT_COUPONS:
        cur.execute(
            "INSERT OR IGNORE INTO coupons (code,discount,active) VALUES (?,?,1)",
            (code, disc),
        )

    # Seed products
    cur.execute("SELECT COUNT(*) c FROM products")
    if cur.fetchone()["c"] == 0 and os.path.exists(SEED_PATH):
        with open(SEED_PATH, "r", encoding="utf-8") as f:
            seed = json.load(f)
        for p in seed:
            inv = p.get("inventory", {}) or {}
            cur.execute(
                """INSERT INTO products
                   (name,brand,price,category,image,description,stock,reorder_level,
                    cost_price,supplier,sku,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    p.get("name"),
                    p.get("brand"),
                    p.get("price"),
                    p.get("category"),
                    p.get("image"),
                    p.get("description"),
                    inv.get("stock", 0),
                    inv.get("reorderLevel", 5),
                    inv.get("costPrice", 0),
                    inv.get("supplier", ""),
                    inv.get("sku", ""),
                    now(),
                ),
            )

    db.commit()

    # Seed a few starter flash deals (only if none exist yet)
    cur.execute("SELECT COUNT(*) c FROM deals")
    if cur.fetchone()["c"] == 0:
        prod_ids = [r["id"] for r in cur.execute("SELECT id FROM products ORDER BY id").fetchall()]
        starter_deals = [
            (0, 25, "Flash Deal", 2),     # 2-day deal
            (4, 30, "Mega Deal", 3),      # 3-day deal
            (9, 20, "Today Only", 1),     # 1-day deal
            (14, 40, "Clearance", 5),     # 5-day deal
            (19, 15, "Weekend Loot", 2),  # 2-day deal
        ]
        for idx, disc, label, days in starter_deals:
            if idx < len(prod_ids):
                ends = (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
                cur.execute(
                    "INSERT INTO deals (product_id,discount,label,ends_at,created_at) VALUES (?,?,?,?,?)",
                    (prod_ids[idx], disc, label, ends, now()),
                )
        db.commit()

    db.close()


def row_to_dict(row):
    return {k: row[k] for k in row.keys()}


def active_deal(db, pid):
    """Return the best (highest discount) still-running deal for a product, or None."""
    return db.execute(
        "SELECT * FROM deals WHERE product_id=? AND ends_at > ? ORDER BY discount DESC LIMIT 1",
        (pid, now()),
    ).fetchone()


def discounted(price, discount):
    return round(price * (100 - discount) / 100)


def product_payload(row):
    d = row_to_dict(row)
    pid = d["id"]
    db = get_db()
    rv = db.execute(
        "SELECT AVG(rating) avg, COUNT(*) c FROM reviews WHERE product_id=?", (pid,)
    ).fetchone()
    d["rating"] = round(rv["avg"], 1) if rv["avg"] else 0
    d["review_count"] = rv["c"]

    deal = active_deal(db, pid)
    if deal:
        d["deal"] = {
            "discount": deal["discount"],
            "label": deal["label"],
            "ends_at": deal["ends_at"],
        }
        d["deal_price"] = discounted(d["price"], deal["discount"])
    else:
        d["deal"] = None
        d["deal_price"] = None
    return d


# --------------------------------------------------------------------------- #
#  Auth helpers
# --------------------------------------------------------------------------- #
def current_user():
    token = request.headers.get("X-Auth-Token")
    if not token:
        return None
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE token=?", (token,)).fetchone()
    return row_to_dict(row) if row else None


def require_admin():
    u = current_user()
    if not u or u["role"] != "admin":
        return None
    return u


def public_user(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "phone": row["phone"],
        "role": row["role"],
        "token": row["token"],
    }


# --------------------------------------------------------------------------- #
#  Static frontend
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(BASE_DIR, filename)


# --------------------------------------------------------------------------- #
#  AUTH API
# --------------------------------------------------------------------------- #
@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    phone = (data.get("phone") or "").strip()
    password = data.get("password") or ""

    if not name or not email or len(password) < 6:
        return jsonify({"error": "Please fill all fields (password min 6 chars)."}), 400

    db = get_db()
    if db.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
        return jsonify({"error": "An account with this email already exists."}), 409

    token = secrets.token_hex(16)
    db.execute(
        "INSERT INTO users (name,email,phone,password,role,token,created_at) VALUES (?,?,?,?,?,?,?)",
        (name, email, phone, generate_password_hash(password), "user", token, now()),
    )
    db.commit()
    row = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    return jsonify({"user": public_user(row)})


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(force=True)
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    db = get_db()
    row = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not row or not check_password_hash(row["password"], password):
        return jsonify({"error": "Invalid email or password."}), 401

    token = secrets.token_hex(16)
    db.execute("UPDATE users SET token=? WHERE id=?", (token, row["id"]))
    db.commit()
    row = db.execute("SELECT * FROM users WHERE id=?", (row["id"],)).fetchone()
    return jsonify({"user": public_user(row)})


@app.route("/api/me", methods=["GET"])
def me():
    u = current_user()
    if not u:
        return jsonify({"user": None})
    return jsonify({"user": {k: u[k] for k in ("id", "name", "email", "phone", "role", "token")}})


# --------------------------------------------------------------------------- #
#  PRODUCTS API
# --------------------------------------------------------------------------- #
@app.route("/api/products", methods=["GET"])
def list_products():
    db = get_db()
    rows = db.execute("SELECT * FROM products ORDER BY id").fetchall()
    return jsonify([product_payload(r) for r in rows])


@app.route("/api/products/<int:pid>", methods=["GET"])
def get_product(pid):
    db = get_db()
    row = db.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    return jsonify(product_payload(row))


@app.route("/api/products", methods=["POST"])
def add_product():
    if not require_admin():
        return jsonify({"error": "Admin only"}), 403
    d = request.get_json(force=True)
    db = get_db()
    cur = db.execute(
        """INSERT INTO products
           (name,brand,price,category,image,description,stock,reorder_level,
            cost_price,supplier,sku,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            d.get("name"),
            d.get("brand", ""),
            float(d.get("price") or 0),
            d.get("category", "Other"),
            d.get("image", ""),
            d.get("description", ""),
            int(d.get("stock") or 0),
            int(d.get("reorder_level") or 5),
            float(d.get("cost_price") or 0),
            d.get("supplier", ""),
            d.get("sku", ""),
            now(),
        ),
    )
    db.commit()
    pid = cur.lastrowid
    db.execute(
        "INSERT INTO stock_movements (product_id,change,type,notes,created_at) VALUES (?,?,?,?,?)",
        (pid, int(d.get("stock") or 0), "Initial", "Product created", now()),
    )
    db.commit()
    row = db.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
    return jsonify(product_payload(row))


@app.route("/api/products/<int:pid>", methods=["PUT"])
def update_product(pid):
    if not require_admin():
        return jsonify({"error": "Admin only"}), 403
    d = request.get_json(force=True)
    db = get_db()
    existing = db.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
    if not existing:
        return jsonify({"error": "Not found"}), 404
    db.execute(
        """UPDATE products SET name=?,brand=?,price=?,category=?,image=?,description=?,
           stock=?,reorder_level=?,cost_price=?,supplier=?,sku=? WHERE id=?""",
        (
            d.get("name", existing["name"]),
            d.get("brand", existing["brand"]),
            float(d.get("price", existing["price"])),
            d.get("category", existing["category"]),
            d.get("image", existing["image"]),
            d.get("description", existing["description"]),
            int(d.get("stock", existing["stock"])),
            int(d.get("reorder_level", existing["reorder_level"])),
            float(d.get("cost_price", existing["cost_price"])),
            d.get("supplier", existing["supplier"]),
            d.get("sku", existing["sku"]),
            pid,
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
    return jsonify(product_payload(row))


@app.route("/api/products/<int:pid>", methods=["DELETE"])
def delete_product(pid):
    if not require_admin():
        return jsonify({"error": "Admin only"}), 403
    db = get_db()
    db.execute("DELETE FROM products WHERE id=?", (pid,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/products/<int:pid>/restock", methods=["POST"])
def restock(pid):
    if not require_admin():
        return jsonify({"error": "Admin only"}), 403
    d = request.get_json(force=True)
    qty = int(d.get("qty") or 0)
    db = get_db()
    db.execute("UPDATE products SET stock = stock + ? WHERE id=?", (qty, pid))
    db.execute(
        "INSERT INTO stock_movements (product_id,change,type,notes,created_at) VALUES (?,?,?,?,?)",
        (pid, qty, "Restock", d.get("notes", "Manual restock"), now()),
    )
    db.commit()
    row = db.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
    return jsonify(product_payload(row))


# --------------------------------------------------------------------------- #
#  ORDERS API
# --------------------------------------------------------------------------- #
@app.route("/api/orders", methods=["POST"])
def place_order():
    u = current_user()
    if not u:
        return jsonify({"error": "Please login to place an order."}), 401
    d = request.get_json(force=True)
    items = d.get("items", [])
    if not items:
        return jsonify({"error": "Cart is empty."}), 400

    db = get_db()
    subtotal = 0
    # validate stock (and apply any active deal price)
    for it in items:
        p = db.execute("SELECT * FROM products WHERE id=?", (it["product_id"],)).fetchone()
        if not p:
            return jsonify({"error": f"Product not found."}), 400
        if p["stock"] < it["qty"]:
            return jsonify({"error": f"Not enough stock for {p['name']}."}), 400
        deal = active_deal(db, p["id"])
        unit = discounted(p["price"], deal["discount"]) if deal else p["price"]
        subtotal += unit * it["qty"]

    discount = 0
    coupon = (d.get("coupon") or "").strip().upper()
    if coupon:
        c = db.execute("SELECT * FROM coupons WHERE code=? AND active=1", (coupon,)).fetchone()
        if c:
            discount = round(subtotal * c["discount"] / 100)
        else:
            coupon = ""

    total = subtotal - discount

    cur = db.execute(
        """INSERT INTO orders
           (user_id,customer_name,total,discount,coupon,payment_method,address,city,phone,status,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (
            u["id"],
            d.get("name", u["name"]),
            total,
            discount,
            coupon,
            d.get("payment_method", "Cash on Delivery"),
            d.get("address", ""),
            d.get("city", ""),
            d.get("phone", ""),
            "Placed",
            now(),
        ),
    )
    order_id = cur.lastrowid

    for it in items:
        p = db.execute("SELECT * FROM products WHERE id=?", (it["product_id"],)).fetchone()
        deal = active_deal(db, p["id"])
        unit = discounted(p["price"], deal["discount"]) if deal else p["price"]
        db.execute(
            "INSERT INTO order_items (order_id,product_id,name,price,qty,image) VALUES (?,?,?,?,?,?)",
            (order_id, p["id"], p["name"], unit, it["qty"], p["image"]),
        )
        db.execute("UPDATE products SET stock = stock - ? WHERE id=?", (it["qty"], p["id"]))
        db.execute(
            "INSERT INTO stock_movements (product_id,change,type,notes,created_at) VALUES (?,?,?,?,?)",
            (p["id"], -it["qty"], "Sale", f"Order #{order_id}", now()),
        )
    db.commit()
    return jsonify({"order_id": order_id, "total": total, "discount": discount})


@app.route("/api/orders", methods=["GET"])
def my_orders():
    u = current_user()
    if not u:
        return jsonify([])
    db = get_db()
    if u["role"] == "admin":
        rows = db.execute("SELECT * FROM orders ORDER BY id DESC").fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM orders WHERE user_id=? ORDER BY id DESC", (u["id"],)
        ).fetchall()
    result = []
    for o in rows:
        od = row_to_dict(o)
        items = db.execute("SELECT * FROM order_items WHERE order_id=?", (o["id"],)).fetchall()
        item_list = []
        for i in items:
            idict = row_to_dict(i)
            idict["reviewed"] = bool(
                db.execute(
                    "SELECT 1 FROM reviews WHERE user_id=? AND product_id=?",
                    (o["user_id"], i["product_id"]),
                ).fetchone()
            )
            item_list.append(idict)
        od["items"] = item_list
        od["stages"] = ORDER_STAGES
        result.append(od)
    return jsonify(result)


@app.route("/api/orders/<int:oid>/status", methods=["POST"])
def update_order_status(oid):
    if not require_admin():
        return jsonify({"error": "Admin only"}), 403
    d = request.get_json(force=True)
    status = d.get("status")
    if status not in ORDER_STAGES:
        return jsonify({"error": "Invalid status"}), 400
    db = get_db()
    current = db.execute("SELECT status FROM orders WHERE id=?", (oid,)).fetchone()
    if not current:
        return jsonify({"error": "Order not found"}), 404
    # A delivered order is final — it can't be moved back or changed.
    if current["status"] == "Delivered":
        return jsonify({"error": "This order is already delivered — its status can't be changed."}), 400
    db.execute("UPDATE orders SET status=? WHERE id=?", (status, oid))
    db.commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------- #
#  REVIEWS API
# --------------------------------------------------------------------------- #
@app.route("/api/products/<int:pid>/reviews", methods=["GET"])
def get_reviews(pid):
    db = get_db()
    rows = db.execute(
        "SELECT * FROM reviews WHERE product_id=? ORDER BY id DESC", (pid,)
    ).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


def has_delivered(db, user_id, product_id):
    """True if this user has a DELIVERED order containing this product."""
    row = db.execute(
        """SELECT 1 FROM orders o
           JOIN order_items oi ON oi.order_id = o.id
           WHERE o.user_id = ? AND oi.product_id = ? AND o.status = 'Delivered' LIMIT 1""",
        (user_id, product_id),
    ).fetchone()
    return row is not None


@app.route("/api/products/<int:pid>/can-review", methods=["GET"])
def can_review(pid):
    """Tell the frontend whether the current user may review this product."""
    u = current_user()
    if not u or u["role"] != "user":
        return jsonify({"delivered": False, "reviewed": False, "review": None})
    db = get_db()
    mine = db.execute(
        "SELECT * FROM reviews WHERE product_id=? AND user_id=?", (pid, u["id"])
    ).fetchone()
    return jsonify(
        {
            "delivered": has_delivered(db, u["id"], pid),
            "reviewed": mine is not None,
            "review": row_to_dict(mine) if mine else None,
        }
    )


@app.route("/api/pending-reviews", methods=["GET"])
def pending_reviews():
    """Delivered products this user hasn't reviewed yet (drives the review prompt)."""
    u = current_user()
    if not u or u["role"] != "user":
        return jsonify([])
    db = get_db()
    rows = db.execute(
        """SELECT DISTINCT p.* FROM orders o
           JOIN order_items oi ON oi.order_id = o.id
           JOIN products p ON p.id = oi.product_id
           WHERE o.user_id = ? AND o.status = 'Delivered'
             AND p.id NOT IN (SELECT product_id FROM reviews WHERE user_id = ?)
           ORDER BY o.id DESC""",
        (u["id"], u["id"]),
    ).fetchall()
    return jsonify([product_payload(r) for r in rows])


@app.route("/api/products/<int:pid>/reviews", methods=["POST"])
def add_review(pid):
    u = current_user()
    if not u:
        return jsonify({"error": "Please login to review."}), 401
    db = get_db()
    # Only buyers whose order was delivered can review
    if not has_delivered(db, u["id"], pid):
        return jsonify({"error": "You can review this product once your order is delivered."}), 403

    d = request.get_json(force=True)
    rating = max(1, min(5, int(d.get("rating") or 5)))
    text = (d.get("text") or "").strip()

    # One review per user per product — update if it already exists
    existing = db.execute(
        "SELECT id FROM reviews WHERE product_id=? AND user_id=?", (pid, u["id"])
    ).fetchone()
    if existing:
        db.execute(
            "UPDATE reviews SET rating=?, text=?, verified=1, created_at=? WHERE id=?",
            (rating, text, now(), existing["id"]),
        )
        db.commit()
        return jsonify({"ok": True, "updated": True})

    db.execute(
        "INSERT INTO reviews (product_id,user_id,user_name,rating,text,verified,created_at) VALUES (?,?,?,?,?,?,?)",
        (pid, u["id"], u["name"], rating, text, 1, now()),
    )
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/reviews/<int:rid>", methods=["DELETE"])
def delete_review(rid):
    if not require_admin():
        return jsonify({"error": "Admin only"}), 403
    db = get_db()
    db.execute("DELETE FROM reviews WHERE id=?", (rid,))
    db.commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------- #
#  QUERIES API
# --------------------------------------------------------------------------- #
@app.route("/api/queries", methods=["GET"])
def list_queries():
    u = current_user()
    if not u:
        return jsonify([])
    db = get_db()
    if u["role"] == "admin":
        rows = db.execute("SELECT * FROM queries ORDER BY id DESC").fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM queries WHERE user_id=? ORDER BY id DESC", (u["id"],)
        ).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route("/api/queries", methods=["POST"])
def add_query():
    u = current_user()
    if not u:
        return jsonify({"error": "Please login first."}), 401
    d = request.get_json(force=True)
    db = get_db()
    db.execute(
        "INSERT INTO queries (user_id,user_name,subject,product_id,message,status,created_at) VALUES (?,?,?,?,?,?,?)",
        (u["id"], u["name"], d.get("subject", ""), d.get("product_id"), d.get("message", ""), "Open", now()),
    )
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/queries/<int:qid>/respond", methods=["POST"])
def respond_query(qid):
    if not require_admin():
        return jsonify({"error": "Admin only"}), 403
    d = request.get_json(force=True)
    db = get_db()
    db.execute(
        "UPDATE queries SET response=?, status=? WHERE id=?",
        (d.get("response", ""), "Resolved", qid),
    )
    db.commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------- #
#  WISHLIST API
# --------------------------------------------------------------------------- #
@app.route("/api/wishlist", methods=["GET"])
def get_wishlist():
    u = current_user()
    if not u:
        return jsonify([])
    db = get_db()
    rows = db.execute(
        """SELECT p.* FROM wishlist w JOIN products p ON p.id=w.product_id
           WHERE w.user_id=? ORDER BY w.id DESC""",
        (u["id"],),
    ).fetchall()
    return jsonify([product_payload(r) for r in rows])


@app.route("/api/wishlist/<int:pid>", methods=["POST"])
def toggle_wishlist(pid):
    u = current_user()
    if not u:
        return jsonify({"error": "Please login first."}), 401
    db = get_db()
    existing = db.execute(
        "SELECT 1 FROM wishlist WHERE user_id=? AND product_id=?", (u["id"], pid)
    ).fetchone()
    if existing:
        db.execute("DELETE FROM wishlist WHERE user_id=? AND product_id=?", (u["id"], pid))
        db.commit()
        return jsonify({"in_wishlist": False})
    db.execute("INSERT OR IGNORE INTO wishlist (user_id,product_id) VALUES (?,?)", (u["id"], pid))
    db.commit()
    return jsonify({"in_wishlist": True})


# --------------------------------------------------------------------------- #
#  COUPONS API
# --------------------------------------------------------------------------- #
@app.route("/api/coupons/validate", methods=["POST"])
def validate_coupon():
    d = request.get_json(force=True)
    code = (d.get("code") or "").strip().upper()
    db = get_db()
    c = db.execute("SELECT * FROM coupons WHERE code=? AND active=1", (code,)).fetchone()
    if not c:
        return jsonify({"valid": False})
    return jsonify({"valid": True, "discount": c["discount"], "code": code})


# --------------------------------------------------------------------------- #
#  DEALS API  (time-limited flash deals)
# --------------------------------------------------------------------------- #
@app.route("/api/deals", methods=["GET"])
def list_deals():
    db = get_db()
    rows = db.execute(
        """SELECT d.id deal_id, d.discount, d.label, d.ends_at, p.*
           FROM deals d JOIN products p ON p.id = d.product_id
           WHERE d.ends_at > ? ORDER BY d.discount DESC""",
        (now(),),
    ).fetchall()
    out = []
    for r in rows:
        d = product_payload(r)
        d["deal_id"] = r["deal_id"]
        # product_payload already fills deal/deal_price from the best active deal
        out.append(d)
    return jsonify(out)


@app.route("/api/deals", methods=["POST"])
def add_deal():
    if not require_admin():
        return jsonify({"error": "Admin only"}), 403
    d = request.get_json(force=True)
    pid = int(d.get("product_id") or 0)
    discount = max(1, min(90, int(d.get("discount") or 10)))
    days = max(1, int(d.get("days") or 1))
    label = (d.get("label") or "Flash Deal").strip()
    db = get_db()
    if not db.execute("SELECT 1 FROM products WHERE id=?", (pid,)).fetchone():
        return jsonify({"error": "Product not found"}), 400
    ends = (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    db.execute(
        "INSERT INTO deals (product_id,discount,label,ends_at,created_at) VALUES (?,?,?,?,?)",
        (pid, discount, label, ends, now()),
    )
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/deals/<int:did>", methods=["DELETE"])
def delete_deal(did):
    if not require_admin():
        return jsonify({"error": "Admin only"}), 403
    db = get_db()
    db.execute("DELETE FROM deals WHERE id=?", (did,))
    db.commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------- #
#  ADMIN DASHBOARD API
# --------------------------------------------------------------------------- #
@app.route("/api/admin/stats", methods=["GET"])
def admin_stats():
    if not require_admin():
        return jsonify({"error": "Admin only"}), 403
    db = get_db()
    total_revenue = db.execute("SELECT COALESCE(SUM(total),0) s FROM orders").fetchone()["s"]
    order_count = db.execute("SELECT COUNT(*) c FROM orders").fetchone()["c"]
    user_count = db.execute("SELECT COUNT(*) c FROM users WHERE role='user'").fetchone()["c"]
    product_count = db.execute("SELECT COUNT(*) c FROM products").fetchone()["c"]
    low_stock = db.execute(
        "SELECT * FROM products WHERE stock <= reorder_level ORDER BY stock ASC"
    ).fetchall()
    inventory_value = db.execute(
        "SELECT COALESCE(SUM(stock*cost_price),0) v FROM products"
    ).fetchone()["v"]
    movements = db.execute(
        """SELECT m.*, p.name pname FROM stock_movements m
           LEFT JOIN products p ON p.id=m.product_id ORDER BY m.id DESC LIMIT 20"""
    ).fetchall()
    return jsonify(
        {
            "revenue": total_revenue,
            "orders": order_count,
            "users": user_count,
            "products": product_count,
            "inventory_value": inventory_value,
            "low_stock": [row_to_dict(r) for r in low_stock],
            "movements": [row_to_dict(m) for m in movements],
        }
    )


# Initialize the database on import, so it works under any WSGI server
# (e.g. gunicorn in production), not only when this file is run directly.
# init_db() is idempotent (CREATE TABLE IF NOT EXISTS + guarded seeding).
init_db()


if __name__ == "__main__":
    init_db()
    print("=" * 60)
    print("  LootLo is running!  Open http://127.0.0.1:5000")
    print("  Admin login -> email: lootlo@gmail.com  pass: lootlo123")
    print("  Database file: lootlo.db (data persists across restarts)")
    print("=" * 60)
    app.run(host="127.0.0.1", port=5000, debug=False)
