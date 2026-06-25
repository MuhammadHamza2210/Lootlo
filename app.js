/* ===================================================================
   LootLo — Frontend logic  (talks to Flask + SQLite backend)
   Developer: Muhammad Hamza
=================================================================== */

const API = "/api";
let TOKEN = localStorage.getItem("lootlo_token") || null;
let USER = null;

let PRODUCTS = [];
let DEALS = [];                     // active flash deals
let CART = JSON.parse(localStorage.getItem("lootlo_cart") || "[]");
let WISHLIST = new Set();           // product ids
let ACTIVE_CAT = "all";
let APPLIED_COUPON = null;          // {code, discount}
let DETAIL_QTY = 1;
let REVIEW_RATING = 5;

/* ---------------- API helper ---------------- */
async function api(path, opts = {}) {
    opts.headers = Object.assign(
        { "Content-Type": "application/json" },
        opts.headers || {}
    );
    if (TOKEN) opts.headers["X-Auth-Token"] = TOKEN;
    const res = await fetch(API + path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw (data && data.error) || "Something went wrong";
    return data;
}
const money = (n) => "Rs " + Number(n).toLocaleString("en-PK");
const $ = (id) => document.getElementById(id);

/* escape user text before putting it in HTML */
function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
}

/* effective unit price = deal price if a deal is active, else normal price */
function effPrice(p) {
    return p && p.deal_price != null ? p.deal_price : (p ? p.price : 0);
}

/* ---- countdown timer for flash deals ---- */
function timeLeft(endsAt) {
    // backend format: "YYYY-MM-DD HH:MM:SS" (local time)
    const end = new Date(endsAt.replace(" ", "T")).getTime();
    let ms = end - Date.now();
    if (ms <= 0) return null;
    const d = Math.floor(ms / 86400000); ms -= d * 86400000;
    const h = Math.floor(ms / 3600000); ms -= h * 3600000;
    const m = Math.floor(ms / 60000); ms -= m * 60000;
    const s = Math.floor(ms / 1000);
    return { d, h, m, s };
}
function cdText(endsAt) {
    const t = timeLeft(endsAt);
    if (!t) return "Ended";
    const pad = (n) => String(n).padStart(2, "0");
    return (t.d > 0 ? t.d + "d " : "") + `${pad(t.h)}:${pad(t.m)}:${pad(t.s)}`;
}
let CD_TIMER = null;
function startCountdownTicker() {
    if (CD_TIMER) return;
    CD_TIMER = setInterval(() => {
        let expired = false;
        document.querySelectorAll(".cd[data-ends]").forEach((el) => {
            const txt = cdText(el.dataset.ends);
            el.textContent = txt;
            if (txt === "Ended") expired = true;
        });
        if (expired) { loadProducts(); }   // a deal just ran out — refresh prices
    }, 1000);
}

/* ===================================================================
   GATEWAY  (login / register / admin)
=================================================================== */
function initGateway() {
    const seg = $("authSeg");
    const pill = $("segPill");
    const btns = [...seg.querySelectorAll(".seg-btn")];
    function moveTo(btn) {
        pill.style.left = btn.offsetLeft + "px";
        pill.style.width = btn.offsetWidth + "px";
    }
    moveTo(btns[0]);
    btns.forEach((b) => {
        b.onclick = () => {
            btns.forEach((x) => x.classList.remove("active"));
            b.classList.add("active");
            moveTo(b);
            document.querySelectorAll(".auth-pane").forEach((p) => p.classList.remove("active"));
            $("pane-" + b.dataset.tab).classList.add("active");
        };
    });

    // password eye toggles
    document.querySelectorAll(".toggle-eye").forEach((eye) => {
        eye.onclick = () => {
            const inp = $(eye.dataset.target);
            inp.type = inp.type === "password" ? "text" : "password";
            eye.classList.toggle("fa-eye");
            eye.classList.toggle("fa-eye-slash");
        };
    });

    $("pane-login").onsubmit = (e) => { e.preventDefault(); doLogin(); };
    $("pane-register").onsubmit = (e) => { e.preventDefault(); doRegister(); };
    $("pane-admin").onsubmit = (e) => { e.preventDefault(); doAdminLogin(); };
}

async function doLogin() {
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    if (!email || !password) return toast("Enter email and password", "error");
    try {
        const r = await api("/login", { method: "POST", body: JSON.stringify({ email, password }) });
        finishAuth(r.user);
    } catch (err) { toast(err, "error"); }
}

async function doRegister() {
    const body = {
        name: $("regName").value.trim(),
        email: $("regEmail").value.trim(),
        phone: $("regPhone").value.trim(),
        password: $("regPassword").value,
    };
    if (!body.name || !body.email || body.password.length < 6)
        return toast("Fill all fields (password min 6 chars)", "error");
    try {
        const r = await api("/register", { method: "POST", body: JSON.stringify(body) });
        toast("Welcome to LootLo, " + r.user.name + "! 🎉", "success");
        finishAuth(r.user);
    } catch (err) { toast(err, "error"); }
}

async function doAdminLogin() {
    const email = $("adminEmail").value.trim();
    const password = $("adminPassword").value;
    try {
        const r = await api("/login", { method: "POST", body: JSON.stringify({ email, password }) });
        if (r.user.role !== "admin") return toast("This is not an admin account", "error");
        finishAuth(r.user);
    } catch (err) { toast(err, "error"); }
}

function finishAuth(user) {
    USER = user;
    TOKEN = user.token;
    localStorage.setItem("lootlo_token", TOKEN);
    const gw = $("gateway");
    gw.classList.add("closing");
    setTimeout(() => {
        gw.classList.add("hidden");
        $("app").classList.remove("hidden");
        bootApp();
    }, 420);
}

function logout() {
    localStorage.removeItem("lootlo_token");
    TOKEN = null; USER = null;
    location.reload();
}

/* ===================================================================
   APP BOOT
=================================================================== */
async function bootApp() {
    // role-based UI
    document.body.dataset.role = USER.role;
    document.querySelectorAll(".user-only").forEach(
        (e) => (e.style.display = USER.role === "user" ? "" : "none")
    );
    document.querySelectorAll(".admin-only").forEach(
        (e) => (e.style.display = USER.role === "admin" ? "" : "none")
    );
    $("userName").textContent = USER.name.split(" ")[0];
    $("userAvatar").textContent = (USER.name[0] || "U").toUpperCase();
    $("umName").textContent = USER.name + (USER.role === "admin" ? " (Admin)" : "");
    $("umEmail").textContent = USER.email;

    await loadProducts();
    if (USER.role === "user") {
        await loadWishlist();
        updateCartBadge();
        checkPendingReviews();
        refreshOrderFab();
        if (!FAB_TIMER) FAB_TIMER = setInterval(refreshOrderFab, 25000);  // keep status live
    }
    if (USER.role === "admin") { showAdmin(); }
    else { showShop(); }
}

async function checkPendingReviews() {
    const badge = $("ordersBadge");
    if (!badge) return;
    try {
        const pending = await api("/pending-reviews");
        if (pending.length) {
            badge.textContent = pending.length;
            badge.style.display = "";
            toast(`⭐ You have ${pending.length} delivered item(s) waiting for a review!`, "info");
        } else {
            badge.style.display = "none";
        }
    } catch (e) {}
}

async function loadProducts() {
    PRODUCTS = await api("/products");
    await loadDeals();
    buildCategoryChips();
    renderProducts();
    populateQueryProducts();
}

async function loadDeals() {
    try { DEALS = await api("/deals"); } catch (e) { DEALS = []; }
    renderDealsRail();
    startCountdownTicker();
}

async function loadWishlist() {
    const w = await api("/wishlist");
    WISHLIST = new Set(w.map((p) => p.id));
    $("wishBadge").textContent = WISHLIST.size;
}

/* ===================================================================
   NAVIGATION
=================================================================== */
function showView(id) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    $("view-" + id).classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
}
function showShop() { showView("shop"); refreshOrderFab(); }
function showWishlist() { renderWishlist(); showView("wishlist"); }
function showOrders() { renderOrders(); showView("orders"); }
function showSupport() { renderQueries(); showView("support"); }
function showAdmin() { renderAdmin(); showView("admin"); }

function toggleUserMenu() { $("userMenu").classList.toggle("show"); }
document.addEventListener("click", (e) => {
    if (!e.target.closest("#userChip")) $("userMenu").classList.remove("show");
    if (!e.target.closest(".searchwrap")) $("suggestions").classList.remove("show");
});

/* ===================================================================
   THEME
=================================================================== */
function initTheme() {
    const saved = localStorage.getItem("lootlo_theme") || "dark";
    document.documentElement.dataset.theme = saved;
    syncThemeIcon();
    $("themeToggle").onclick = () => {
        const cur = document.documentElement.dataset.theme;
        const next = cur === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        localStorage.setItem("lootlo_theme", next);
        syncThemeIcon();
    };
}
function syncThemeIcon() {
    const dark = document.documentElement.dataset.theme === "dark";
    $("themeToggle").innerHTML = dark ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
}

/* ===================================================================
   CATEGORY CHIPS + PRODUCT GRID
=================================================================== */
function buildCategoryChips() {
    const cats = ["all", ...new Set(PRODUCTS.map((p) => p.category))];
    $("categoryChips").innerHTML = cats
        .map(
            (c) =>
                `<button class="chip ${c === ACTIVE_CAT ? "active" : ""}" onclick="filterCat('${c.replace(/'/g, "\\'")}')">${c === "all" ? "All Products" : c}</button>`
        )
        .join("");
}
function filterCat(c) {
    ACTIVE_CAT = c;
    buildCategoryChips();
    renderProducts();
}

function visibleProducts() {
    let list = PRODUCTS.slice();
    if (ACTIVE_CAT !== "all") list = list.filter((p) => p.category === ACTIVE_CAT);
    const q = $("searchInput").value.trim().toLowerCase();
    if (q) list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.brand || "").toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q)
    );
    const sort = $("sortSelect").value;
    if (sort === "low") list.sort((a, b) => a.price - b.price);
    else if (sort === "high") list.sort((a, b) => b.price - a.price);
    else if (sort === "rating") list.sort((a, b) => b.rating - a.rating);
    return list;
}

function stars(rating) {
    const full = Math.round(rating);
    return "★".repeat(full) + "☆".repeat(5 - full);
}

function productCard(p) {
    const inWish = WISHLIST.has(p.id);
    const out = p.stock <= 0;
    const low = !out && p.stock <= p.reorder_level;
    let flag = "";
    if (out) flag = `<span class="stock-flag flag-out">Out of stock</span>`;
    else if (low) flag = `<span class="stock-flag flag-low">Only ${p.stock} left!</span>`;
    const dealBadge = p.deal ? `<span class="card-deal-badge">-${p.deal.discount}%</span>` : "";
    const priceHtml = p.deal
        ? `<div class="price"><span class="cur">Rs</span> ${Number(p.deal_price).toLocaleString("en-PK")} <span class="was">Rs ${Number(p.price).toLocaleString("en-PK")}</span></div>`
        : `<div class="price"><span class="cur">Rs</span> ${Number(p.price).toLocaleString("en-PK")}</div>`;
    const wishBtn = USER && USER.role === "user"
        ? `<button class="wish-toggle ${inWish ? "on" : ""}" onclick="event.stopPropagation();toggleWish(${p.id})"><i class="fa${inWish ? "s" : "r"} fa-heart"></i></button>`
        : "";
    const addBtn = USER && USER.role === "user"
        ? `<button class="add-btn" ${out ? "disabled" : ""} onclick="event.stopPropagation();addToCart(${p.id})">${out ? "Sold out" : '<i class="fas fa-cart-plus"></i> Add'}</button>`
        : "";
    return `
    <div class="pcard" onclick="openProduct(${p.id})">
        <div class="pcard-img">
            <img src="${p.image}" alt="${p.name}" loading="lazy" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22300%22%3E%3Crect width=%22100%25%22 height=%22100%25%22 fill=%22%23ddd%22/%3E%3C/svg%3E'">
            <span class="pcard-cat">${p.category}</span>
            ${dealBadge}
            ${wishBtn}
            ${flag}
        </div>
        <div class="pcard-body">
            <div class="pcard-brand">${p.brand || ""}</div>
            <div class="pcard-name">${p.name}</div>
            <div class="pcard-rate">${stars(p.rating)} <small>${p.review_count ? "(" + p.review_count + ")" : "(new)"}</small></div>
            <div class="pcard-foot">
                ${priceHtml}
                ${addBtn}
            </div>
        </div>
    </div>`;
}

function renderProducts() {
    const list = visibleProducts();
    const grid = $("productsGrid");
    $("gridTitle").textContent =
        ACTIVE_CAT === "all" ? "Featured Products" : ACTIVE_CAT;
    grid.innerHTML = list.length
        ? list.map(productCard).join("")
        : `<div class="empty" style="grid-column:1/-1"><i class="fas fa-box-open"></i>No products found.</div>`;
}

/* ---- Flash deals rail ---- */
function dealCard(p) {
    const out = p.stock <= 0;
    const canShop = USER && USER.role === "user";
    const addBtn = canShop
        ? `<button class="add-btn" ${out ? "disabled" : ""} onclick="event.stopPropagation();addToCart(${p.id})">${out ? "Sold out" : '<i class="fas fa-cart-plus"></i> Grab'}</button>`
        : "";
    return `
    <div class="deal-card" onclick="openProduct(${p.id})">
        <div class="deal-badge">-${p.deal.discount}%</div>
        <div class="deal-img">
            <img src="${p.image}" alt="${p.name}" loading="lazy" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22300%22%3E%3Crect width=%22100%25%22 height=%22100%25%22 fill=%22%23ddd%22/%3E%3C/svg%3E'">
            <span class="deal-label">${p.deal.label}</span>
        </div>
        <div class="deal-body">
            <div class="pcard-name" style="min-height:auto">${p.name}</div>
            <div class="deal-price-row">
                <span class="deal-now">${money(p.deal_price)}</span>
                <span class="deal-was">${money(p.price)}</span>
            </div>
            <div class="deal-timer"><i class="fas fa-clock"></i> Ends in <b class="cd" data-ends="${p.deal.ends_at}">${cdText(p.deal.ends_at)}</b></div>
            ${addBtn}
        </div>
    </div>`;
}
function renderDealsRail() {
    const wrap = $("dealsWrap");
    const rail = $("dealsRail");
    if (!wrap || !rail) return;
    if (!DEALS.length) { wrap.style.display = "none"; return; }
    wrap.style.display = "";
    rail.innerHTML = DEALS.map(dealCard).join("");
}

/* live search suggestions */
function initSearch() {
    const inp = $("searchInput");
    inp.addEventListener("input", () => {
        renderProducts();
        const q = inp.value.trim().toLowerCase();
        const box = $("suggestions");
        if (!q) { box.classList.remove("show"); return; }
        const matches = PRODUCTS.filter(
            (p) => p.name.toLowerCase().includes(q) || (p.brand || "").toLowerCase().includes(q)
        ).slice(0, 6);
        if (!matches.length) { box.classList.remove("show"); return; }
        box.innerHTML = matches
            .map((p) => `<div onclick="openProduct(${p.id})"><img src="${p.image}"><span>${p.name}</span><b style="margin-left:auto;color:var(--accent)">${money(p.price)}</b></div>`)
            .join("");
        box.classList.add("show");
    });
}

/* ===================================================================
   PRODUCT DETAIL + REVIEWS
=================================================================== */
async function openProduct(id) {
    const p = PRODUCTS.find((x) => x.id === id) || (await api("/products/" + id));
    DETAIL_QTY = 1;
    const reviews = await api(`/products/${id}/reviews`);
    const out = p.stock <= 0;
    const canShop = USER && USER.role === "user";

    // can this user review? (must have a DELIVERED order)
    let rs = { delivered: false, reviewed: false, review: null };
    if (canShop) {
        try { rs = await api(`/products/${id}/can-review`); } catch (e) {}
    }
    REVIEW_RATING = rs.review ? rs.review.rating : 5;

    let reviewForm = "";
    if (canShop && rs.delivered) {
        const existing = rs.review;
        reviewForm = `<div class="review-box" style="margin-top:18px">
             <h3 style="margin-bottom:6px;display:flex;align-items:center;gap:10px">
                ${existing ? "Update your review" : "Rate your purchase"}
                <span class="verified-tag"><i class="fas fa-circle-check"></i> Verified buyer</span>
             </h3>
             <div class="review-stars" id="revStars">${[1,2,3,4,5].map(i=>`<span data-r="${i}" class="${i<=REVIEW_RATING?'on':''}">★</span>`).join("")}</div>
             <textarea id="revText" placeholder="Share your experience..." style="width:100%;padding:11px;border-radius:11px;border:1px solid var(--glass-border);background:var(--glass);color:var(--text);font-family:inherit">${escHtml(existing ? existing.text : "")}</textarea>
             <button class="btn-primary" style="margin-top:10px" onclick="submitReview(${id})">${existing ? "Update review" : "Post review"}</button>
           </div>`;
    } else if (canShop && !rs.delivered) {
        reviewForm = `<div class="review-locked"><i class="fas fa-truck-fast"></i> You can rate this product once your order is delivered.</div>`;
    }

    openModal(
        `
        <div class="modal-head"><h2>Product Details</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
        <div class="pd">
            <div class="pd-img"><img src="${p.image}" onerror="this.style.opacity=.3"></div>
            <div>
                <div class="pcard-brand">${p.brand || ""}</div>
                <h2>${p.name}</h2>
                <div class="pcard-rate">${stars(p.rating)} <small>${p.review_count} review(s)</small></div>
                ${p.deal
                    ? `<div class="pd-deal-tag">${p.deal.label} · <b class="cd" data-ends="${p.deal.ends_at}">${cdText(p.deal.ends_at)}</b> left</div>
                       <div class="price"><span class="cur">Rs</span> ${Number(p.deal_price).toLocaleString("en-PK")} <span class="was">Rs ${Number(p.price).toLocaleString("en-PK")}</span> <span class="save-tag">Save ${p.deal.discount}%</span></div>`
                    : `<div class="price"><span class="cur">Rs</span> ${Number(p.price).toLocaleString("en-PK")}</div>`}
                <div class="pd-desc">${p.description || ""}</div>
                <div><b style="color:${out?'var(--bad)':'var(--good)'}">${out ? "Out of stock" : p.stock + " in stock"}</b></div>
                ${canShop && !out ? `
                <div class="qty-pick">
                    <button onclick="detailQty(-1)">−</button><span id="dQty">1</span><button onclick="detailQty(1)">+</button>
                </div>
                <button class="btn-primary glow" onclick="addToCart(${id}, document.getElementById('dQty') ? +document.getElementById('dQty').textContent : 1); closeModal()"><i class="fas fa-cart-plus"></i> Add to cart</button>
                ` : ""}
            </div>
        </div>
        <hr style="border:none;border-top:1px solid var(--glass-border);margin:22px 0">
        <h3>Customer Reviews</h3>
        <div id="reviewList">${renderReviewList(reviews)}</div>
        ${reviewForm}
    `,
        true
    );

    const sc = $("revStars");
    if (sc) {
        sc.querySelectorAll("span").forEach((s) => {
            s.onclick = () => {
                REVIEW_RATING = +s.dataset.r;
                sc.querySelectorAll("span").forEach((x) => x.classList.toggle("on", +x.dataset.r <= REVIEW_RATING));
            };
        });
    }
}
function detailQty(d) {
    const el = $("dQty");
    DETAIL_QTY = Math.max(1, (+el.textContent) + d);
    el.textContent = DETAIL_QTY;
}
function renderReviewList(reviews) {
    if (!reviews.length) return `<p style="color:var(--muted)">No reviews yet. Be the first!</p>`;
    return reviews
        .map(
            (r) => `<div class="review-item">
        <div class="rv-head">
            <span class="rv-name">${escHtml(r.user_name)} ${r.verified ? `<span class="verified-tag sm"><i class="fas fa-circle-check"></i> Verified Purchase</span>` : ""}</span>
            <span class="rv-stars">${stars(r.rating)}</span>
        </div>
        <div class="rv-text">${escHtml(r.text)}</div>
        <div class="rv-date">${r.created_at || ""}</div>
        ${USER && USER.role === "admin" ? `<button class="tbtn del" style="margin-top:6px" onclick="deleteReview(${r.id},${r.product_id})"><i class="fas fa-trash"></i></button>` : ""}
      </div>`
        )
        .join("");
}
async function submitReview(pid) {
    const text = $("revText").value.trim();
    try {
        const r = await api(`/products/${pid}/reviews`, { method: "POST", body: JSON.stringify({ rating: REVIEW_RATING, text }) });
        toast(r.updated ? "Your review was updated ⭐" : "Thanks for your review! ⭐", "success");
        await loadProducts();
        checkPendingReviews();
        openProduct(pid);
    } catch (e) { toast(e, "error"); }
}
async function deleteReview(rid, pid) {
    try { await api("/reviews/" + rid, { method: "DELETE" }); toast("Review deleted", "info"); openProduct(pid); }
    catch (e) { toast(e, "error"); }
}

/* ===================================================================
   WISHLIST
=================================================================== */
async function toggleWish(id) {
    try {
        const r = await api("/wishlist/" + id, { method: "POST" });
        if (r.in_wishlist) { WISHLIST.add(id); toast("Added to wishlist ❤", "success"); }
        else { WISHLIST.delete(id); toast("Removed from wishlist", "info"); }
        $("wishBadge").textContent = WISHLIST.size;
        renderProducts();
        if ($("view-wishlist").classList.contains("active")) renderWishlist();
    } catch (e) { toast(e, "error"); }
}
async function renderWishlist() {
    const list = await api("/wishlist");
    WISHLIST = new Set(list.map((p) => p.id));
    $("wishBadge").textContent = WISHLIST.size;
    $("wishlistGrid").innerHTML = list.length
        ? list.map(productCard).join("")
        : `<div class="empty" style="grid-column:1/-1"><i class="fas fa-heart-crack"></i>Your wishlist is empty.</div>`;
}

/* ===================================================================
   CART
=================================================================== */
function saveCart() { localStorage.setItem("lootlo_cart", JSON.stringify(CART)); updateCartBadge(); }
function updateCartBadge() {
    $("cartBadge").textContent = CART.reduce((s, i) => s + i.qty, 0);
}
function addToCart(id, qty = 1) {
    const p = PRODUCTS.find((x) => x.id === id);
    if (!p) return;
    const ex = CART.find((i) => i.product_id === id);
    if (ex) ex.qty += qty; else CART.push({ product_id: id, qty });
    saveCart();
    toast(`${p.name} added to cart 🛒`, "success");
}
function changeQty(id, d) {
    const it = CART.find((i) => i.product_id === id);
    if (!it) return;
    it.qty += d;
    if (it.qty <= 0) CART = CART.filter((i) => i.product_id !== id);
    saveCart();
    showCart();
}
function removeFromCart(id) {
    CART = CART.filter((i) => i.product_id !== id);
    saveCart();
    showCart();
}
function cartDetailed() {
    return CART.map((i) => ({ ...i, p: PRODUCTS.find((x) => x.id === i.product_id) })).filter((x) => x.p);
}
function cartSubtotal() {
    return cartDetailed().reduce((s, i) => s + effPrice(i.p) * i.qty, 0);
}
function showCart() {
    const items = cartDetailed();
    if (!items.length) {
        openModal(`<div class="modal-head"><h2>Your Cart</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
            <div class="empty"><i class="fas fa-cart-shopping"></i>Your cart is empty.<br><button class="btn-primary" style="margin-top:16px;width:auto;padding:12px 22px;display:inline-flex" onclick="closeModal()">Start shopping</button></div>`);
        return;
    }
    const sub = cartSubtotal();
    const disc = APPLIED_COUPON ? Math.round((sub * APPLIED_COUPON.discount) / 100) : 0;
    openModal(`
        <div class="modal-head"><h2>Your Cart</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
        ${items.map((i) => `
            <div class="cart-item">
                <img src="${i.p.image}">
                <div class="ci-info">
                    <div class="ci-name">${i.p.name}</div>
                    <div class="ci-price">${money(effPrice(i.p))} ${i.p.deal ? `<span class="was">${money(i.p.price)}</span>` : ""}</div>
                    <div class="mini-qty">
                        <button onclick="changeQty(${i.product_id},-1)">−</button>
                        <span>${i.qty}</span>
                        <button onclick="changeQty(${i.product_id},1)">+</button>
                    </div>
                </div>
                <button class="trash" onclick="removeFromCart(${i.product_id})"><i class="fas fa-trash"></i></button>
            </div>`).join("")}
        <div class="coupon-row">
            <input id="couponInput" placeholder="Promo code" value="${APPLIED_COUPON ? APPLIED_COUPON.code : ""}">
            <button onclick="applyCoupon()">Apply</button>
        </div>
        ${APPLIED_COUPON ? `<div class="coupon-ok"><i class="fas fa-check-circle"></i> ${APPLIED_COUPON.code} applied — ${APPLIED_COUPON.discount}% off</div>` : ""}
        <div class="cart-summary">
            <div class="sum-row"><span>Subtotal</span><span>${money(sub)}</span></div>
            ${disc ? `<div class="sum-row" style="color:var(--good)"><span>Discount</span><span>− ${money(disc)}</span></div>` : ""}
            <div class="sum-row total"><span>Total</span><span>${money(sub - disc)}</span></div>
            <button class="btn-primary glow" style="margin-top:14px" onclick="openCheckout()"><i class="fas fa-bag-shopping"></i> Proceed to checkout</button>
        </div>
    `);
}
async function applyCoupon() {
    const code = $("couponInput").value.trim();
    if (!code) return;
    const r = await api("/coupons/validate", { method: "POST", body: JSON.stringify({ code }) });
    if (r.valid) { APPLIED_COUPON = { code: r.code, discount: r.discount }; toast(`Coupon applied — ${r.discount}% off! 🎉`, "success"); }
    else { APPLIED_COUPON = null; toast("Invalid or expired coupon", "error"); }
    showCart();
}
function copyCoupon(code) {
    navigator.clipboard && navigator.clipboard.writeText(code);
    APPLIED_COUPON = null;
    toast(`Code ${code} copied — apply it in your cart!`, "info");
}

/* ===================================================================
   CHECKOUT + ORDER
=================================================================== */
function openCheckout() {
    const sub = cartSubtotal();
    const disc = APPLIED_COUPON ? Math.round((sub * APPLIED_COUPON.discount) / 100) : 0;
    openModal(`
        <div class="modal-head"><h2>Checkout</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
        <div class="form-row"><label>Full name</label><input id="coName" value="${USER.name}"></div>
        <div class="form-grid">
            <div class="form-row"><label>Phone</label><input id="coPhone" value="${USER.phone || ''}" placeholder="03001234567"></div>
            <div class="form-row"><label>City</label><input id="coCity" placeholder="Karachi"></div>
        </div>
        <div class="form-row"><label>Delivery address</label><textarea id="coAddress" rows="2" placeholder="House, street, area..."></textarea></div>
        <div class="form-row"><label>Payment method</label>
            <select id="coPay">
                <option>Cash on Delivery</option>
                <option>Credit / Debit Card</option>
                <option>JazzCash</option>
                <option>Easypaisa</option>
            </select>
        </div>
        <div class="cart-summary">
            <div class="sum-row"><span>Subtotal</span><span>${money(sub)}</span></div>
            ${disc ? `<div class="sum-row" style="color:var(--good)"><span>Discount (${APPLIED_COUPON.code})</span><span>− ${money(disc)}</span></div>` : ""}
            <div class="sum-row total"><span>Total payable</span><span>${money(sub - disc)}</span></div>
            <button class="btn-primary glow" style="margin-top:14px" onclick="placeOrder()"><i class="fas fa-lock"></i> Place order</button>
        </div>
    `);
}

async function placeOrder() {
    const body = {
        name: $("coName").value.trim(),
        phone: $("coPhone").value.trim(),
        city: $("coCity").value.trim(),
        address: $("coAddress").value.trim(),
        payment_method: $("coPay").value,
        coupon: APPLIED_COUPON ? APPLIED_COUPON.code : "",
        items: CART.map((i) => ({ product_id: i.product_id, qty: i.qty })),
    };
    if (!body.address || !body.city) return toast("Please enter your delivery address & city", "error");
    try {
        const r = await api("/orders", { method: "POST", body: JSON.stringify(body) });
        CART = []; APPLIED_COUPON = null; saveCart();
        await loadProducts();
        refreshOrderFab();
        fireConfetti();
        openModal(`
            <div class="empty" style="padding:30px 10px">
                <i class="fas fa-circle-check" style="color:var(--good);font-size:64px"></i>
                <h2 style="margin:14px 0 6px">Order placed! 🎉</h2>
                <p>Order <b>#${r.order_id}</b> · Total <b>${money(r.total)}</b></p>
                ${r.discount ? `<p style="color:var(--good)">You saved ${money(r.discount)}!</p>` : ""}
                <button class="btn-primary" style="margin-top:18px;width:auto;padding:12px 22px;display:inline-flex" onclick="closeModal();showOrders()">Track my order</button>
            </div>`);
    } catch (e) { toast(e, "error"); }
}

/* ===================================================================
   ORDERS + TRACKING
=================================================================== */
const STAGES = ["Placed", "Confirmed", "Shipped", "Out for Delivery", "Delivered"];
function trackBar(status) {
    const idx = STAGES.indexOf(status);
    return `<div class="track">${STAGES.map((s, i) => `
        <div class="track-step ${i <= idx ? "done" : ""}">
            <div class="track-line"></div>
            <div class="track-dot">${i <= idx ? '<i class="fas fa-check"></i>' : i + 1}</div>
            ${s}
        </div>`).join("")}</div>`;
}
let MY_ORDERS = [];

/* estimated delivery = order date + 5 days */
function estDelivery(o) {
    const created = new Date(o.created_at.replace(" ", "T"));
    created.setDate(created.getDate() + 5);
    return created.toLocaleDateString("en-PK", { weekday: "short", day: "numeric", month: "short" });
}

function orderItemRow(o, it) {
    const delivered = o.status === "Delivered";
    let action;
    if (delivered && it.reviewed) {
        action = `<button class="oi-review-btn done" onclick="openProduct(${it.product_id})"><i class="fas fa-star"></i> Reviewed</button>`;
    } else if (delivered) {
        action = `<button class="oi-review-btn pulse" onclick="openProduct(${it.product_id})"><i class="far fa-star"></i> Rate now</button>`;
    } else {
        action = `<span class="oi-soon"><i class="fas fa-truck-fast"></i> Review after delivery</span>`;
    }
    return `<div class="oi-row">
        <img class="order-thumb" src="${it.image}" onerror="this.style.opacity=.3">
        <div class="oi-info">
            <div class="oi-name">${escHtml(it.name)}</div>
            <div class="oi-qty">Qty ${it.qty} · ${money(it.price)}</div>
        </div>
        ${action}
    </div>`;
}

async function renderOrders() {
    const orders = await api("/orders");
    MY_ORDERS = orders;
    const box = $("ordersList");

    // review request banner (delivered & not yet reviewed)
    let pending = [];
    try { pending = await api("/pending-reviews"); } catch (e) {}
    const banner = pending.length
        ? `<div class="review-request">
             <div class="rr-head"><i class="fas fa-star"></i> Your order was delivered — how was it? Please rate ${pending.length} item(s):</div>
             <div class="rr-items">${pending.map((p) => `<button class="rr-chip" onclick="openProduct(${p.id})"><img src="${p.image}">${escHtml(p.name)} <i class="fas fa-arrow-right"></i></button>`).join("")}</div>
           </div>`
        : "";

    if (!orders.length) {
        box.innerHTML = banner + `<div class="empty"><i class="fas fa-box-open"></i>No orders yet.</div>`;
        return;
    }
    box.innerHTML = banner + orders.map((o) => {
        const stCls = "st-" + o.status.split(" ")[0];
        const delivered = o.status === "Delivered";
        return `<div class="order-card">
            <div class="order-top">
                <div><div class="order-id">Order #${o.id}</div><div class="order-date">${o.created_at} · ${o.payment_method}</div></div>
                <div style="text-align:right">
                    <span class="status-pill ${stCls}">${o.status}</span>
                    <div class="price" style="margin-top:6px">${money(o.total)}</div>
                </div>
            </div>
            <div class="order-eta ${delivered ? "done" : ""}">
                <i class="fas ${delivered ? "fa-circle-check" : "fa-truck-fast"}"></i>
                ${delivered ? "Delivered successfully 🎉" : `Estimated delivery: <b>${estDelivery(o)}</b>`}
                <button class="track-btn" onclick="trackOrder(${o.id})"><i class="fas fa-location-dot"></i> Track order</button>
            </div>
            ${trackBar(o.status)}
            <div class="order-items-list">${o.items.map((it) => orderItemRow(o, it)).join("")}</div>
            ${o.coupon ? `<div style="margin-top:10px;color:var(--good);font-size:13px"><i class="fas fa-tag"></i> ${o.coupon} · saved ${money(o.discount)}</div>` : ""}
        </div>`;
    }).join("");
}

/* ---- floating live order tracker (always reachable while shopping) ---- */
let LATEST_ACTIVE_ORDER = null;
let FAB_TIMER = null;
async function refreshOrderFab() {
    const fab = $("orderFab");
    if (!fab) return;
    if (!USER || USER.role !== "user") { fab.classList.add("hidden"); return; }
    let orders;
    try { orders = await api("/orders"); } catch (e) { return; }
    MY_ORDERS = orders;
    // orders come newest-first; grab the latest one that isn't delivered yet
    const active = orders.find((o) => o.status !== "Delivered");
    if (!active) { LATEST_ACTIVE_ORDER = null; fab.classList.add("hidden"); return; }
    LATEST_ACTIVE_ORDER = active.id;
    const idx = STAGES.indexOf(active.status);
    $("fabTitle").textContent = `Order #${active.id} · ${active.status}`;
    $("fabSub").textContent = `Step ${idx + 1} of ${STAGES.length} · ETA ${estDelivery(active)}`;
    fab.classList.remove("hidden");
}
function trackLatestOrder() {
    if (LATEST_ACTIVE_ORDER != null) trackOrder(LATEST_ACTIVE_ORDER);
    else showOrders();
}

/* detailed step-by-step tracking modal */
function trackOrder(id) {
    const o = MY_ORDERS.find((x) => x.id === id);
    if (!o) return;
    const idx = STAGES.indexOf(o.status);
    const delivered = o.status === "Delivered";
    const steps = STAGES.map((s, i) => {
        const cls = i < idx ? "done" : i === idx ? "current" : "";
        const sub = i < idx ? "Completed" : i === idx ? (delivered ? "Delivered 🎉" : "In progress…") : "Pending";
        return `<div class="tl-step ${cls}">
            <div class="tl-dot">${i <= idx ? '<i class="fas fa-check"></i>' : i + 1}</div>
            <div class="tl-info"><div class="tl-name">${s}</div><div class="tl-sub">${sub}</div></div>
        </div>`;
    }).join("");
    openModal(`
        <div class="modal-head"><h2>Track Order #${o.id}</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
        <div class="track-meta">
            <div><span class="tm-label">Status</span><span class="status-pill st-${o.status.split(" ")[0]}">${o.status}</span></div>
            <div><span class="tm-label">${delivered ? "Delivered" : "Est. delivery"}</span><b>${delivered ? "Done" : estDelivery(o)}</b></div>
            <div><span class="tm-label">Order total</span><b>${money(o.total)}</b></div>
        </div>
        <div class="timeline">${steps}</div>
        <div class="track-thumbs">${o.items.map((it) => `<img src="${it.image}" title="${escHtml(it.name)} ×${it.qty}" onerror="this.style.opacity=.3">`).join("")}</div>
        ${delivered ? `<button class="btn-primary" style="margin-top:18px" onclick="closeModal();showOrders()"><i class="fas fa-star"></i> Rate your items</button>` : ""}
    `);
}

/* ===================================================================
   SUPPORT / QUERIES
=================================================================== */
function populateQueryProducts() {
    const sel = $("qProduct");
    if (!sel) return;
    sel.innerHTML = `<option value="">Related product (optional)</option>` +
        PRODUCTS.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
}
async function submitQuery() {
    const subject = $("qSubject").value.trim();
    const message = $("qMessage").value.trim();
    const product_id = $("qProduct").value || null;
    if (!subject || !message) return toast("Enter subject and message", "error");
    try {
        await api("/queries", { method: "POST", body: JSON.stringify({ subject, message, product_id }) });
        $("qSubject").value = ""; $("qMessage").value = "";
        toast("Query submitted — we'll get back soon! 📨", "success");
        renderQueries();
    } catch (e) { toast(e, "error"); }
}
async function renderQueries() {
    const qs = await api("/queries");
    $("queriesList").innerHTML = qs.length
        ? qs.map((q) => `<div class="query-item">
              <div class="qi-subj">${q.subject}<span class="status-pill ${q.status==='Resolved'?'st-Delivered':'st-Placed'}">${q.status}</span></div>
              <div class="qi-msg">${q.message}</div>
              ${q.response ? `<div class="query-resp"><b>Support:</b> ${q.response}</div>` : ""}
           </div>`).join("")
        : `<p style="color:var(--muted)">No queries yet.</p>`;
}

/* ===================================================================
   ADMIN CONSOLE
=================================================================== */
function initAdminSeg() {
    const seg = $("adminSeg");
    const pill = $("adminPill");
    const btns = [...seg.querySelectorAll(".seg-btn")];
    function moveTo(btn) { pill.style.left = btn.offsetLeft + "px"; pill.style.width = btn.offsetWidth + "px"; }
    requestAnimationFrame(() => moveTo(btns[0]));
    btns.forEach((b) => {
        b.onclick = () => {
            btns.forEach((x) => x.classList.remove("active"));
            b.classList.add("active"); moveTo(b);
            document.querySelectorAll(".admin-pane").forEach((p) => p.classList.remove("active"));
            $("apane-" + b.dataset.atab).classList.add("active");
        };
    });
}
async function renderAdmin() {
    initAdminSeg();
    const stats = await api("/admin/stats");
    $("statRow").innerHTML = `
        ${statCard("Revenue", money(stats.revenue), "fa-sack-dollar")}
        ${statCard("Orders", stats.orders, "fa-receipt")}
        ${statCard("Customers", stats.users, "fa-users")}
        ${statCard("Products", stats.products, "fa-box")}
        ${statCard("Stock Value", money(stats.inventory_value), "fa-warehouse")}
    `;
    renderAdminProducts();
    renderAdminDeals();
    renderAdminInventory(stats);
    renderAdminOrders();
    renderAdminQueries();
}
function statCard(label, val, icon) {
    return `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${val}</div><i class="fas ${icon} si"></i></div>`;
}

async function renderAdminProducts() {
    const rows = PRODUCTS.map((p) => `
        <tr>
            <td><img src="${p.image}"></td>
            <td><b>${p.name}</b><br><small style="color:var(--muted)">${p.brand || ""} · ${p.sku || ""}</small></td>
            <td>${p.category}</td>
            <td>${money(p.price)}</td>
            <td class="stk ${p.stock<=0?'stk-out':p.stock<=p.reorder_level?'stk-low':'stk-ok'}">${p.stock}</td>
            <td><div class="t-actions">
                <button class="tbtn" title="Edit" onclick="openProductForm(${p.id})"><i class="fas fa-pen"></i></button>
                <button class="tbtn ok" title="Restock" onclick="openRestock(${p.id})"><i class="fas fa-plus"></i></button>
                <button class="tbtn del" title="Delete" onclick="deleteProduct(${p.id})"><i class="fas fa-trash"></i></button>
            </div></td>
        </tr>`).join("");
    $("apane-products").innerHTML = `
        <div class="admin-bar">
            <h3>Products (${PRODUCTS.length})</h3>
            <button class="btn-add" onclick="openProductForm()"><i class="fas fa-plus"></i> Add product</button>
        </div>
        <div class="table-scroll"><table class="admin-table">
            <thead><tr><th></th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>`;
}

function openProductForm(id) {
    const p = id ? PRODUCTS.find((x) => x.id === id) : {};
    const cats = [...new Set(PRODUCTS.map((x) => x.category))];
    openModal(`
        <div class="modal-head"><h2>${id ? "Edit" : "Add"} Product</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
        <div class="form-grid">
            <div class="form-row"><label>Name</label><input id="pfName" value="${p.name || ""}"></div>
            <div class="form-row"><label>Brand</label><input id="pfBrand" value="${p.brand || ""}"></div>
        </div>
        <div class="form-grid">
            <div class="form-row"><label>Price (Rs)</label><input id="pfPrice" type="number" value="${p.price || ""}"></div>
            <div class="form-row"><label>Category</label>
                <input id="pfCat" list="catlist" value="${p.category || ""}">
                <datalist id="catlist">${cats.map((c)=>`<option value="${c}">`).join("")}</datalist>
            </div>
        </div>
        <div class="form-row"><label>Image path or URL</label><input id="pfImage" value="${p.image || "images/"}" placeholder="images/yourfile.jpg"></div>
        <div class="form-row"><label>Description</label><textarea id="pfDesc" rows="3">${p.description || ""}</textarea></div>
        <div class="form-grid">
            <div class="form-row"><label>Stock</label><input id="pfStock" type="number" value="${p.stock ?? 0}"></div>
            <div class="form-row"><label>Reorder level</label><input id="pfReorder" type="number" value="${p.reorder_level ?? 5}"></div>
        </div>
        <div class="form-grid">
            <div class="form-row"><label>Cost price</label><input id="pfCost" type="number" value="${p.cost_price ?? 0}"></div>
            <div class="form-row"><label>Supplier</label><input id="pfSupplier" value="${p.supplier || ""}"></div>
        </div>
        <div class="form-row"><label>SKU</label><input id="pfSku" value="${p.sku || ""}"></div>
        <button class="btn-primary glow" onclick="saveProduct(${id || 0})"><i class="fas fa-floppy-disk"></i> ${id ? "Save changes" : "Add product"}</button>
    `);
}
async function saveProduct(id) {
    const body = {
        name: $("pfName").value.trim(),
        brand: $("pfBrand").value.trim(),
        price: $("pfPrice").value,
        category: $("pfCat").value.trim() || "Other",
        image: $("pfImage").value.trim(),
        description: $("pfDesc").value.trim(),
        stock: $("pfStock").value,
        reorder_level: $("pfReorder").value,
        cost_price: $("pfCost").value,
        supplier: $("pfSupplier").value.trim(),
        sku: $("pfSku").value.trim(),
    };
    if (!body.name || !body.price) return toast("Name and price are required", "error");
    try {
        if (id) await api("/products/" + id, { method: "PUT", body: JSON.stringify(body) });
        else await api("/products", { method: "POST", body: JSON.stringify(body) });
        toast(id ? "Product updated ✅" : "Product added ✅", "success");
        closeModal();
        await loadProducts();
        renderAdmin();
    } catch (e) { toast(e, "error"); }
}
function deleteProduct(id) {
    const p = PRODUCTS.find((x) => x.id === id);
    confirmModal(`Delete "${p.name}"?`, "This cannot be undone.", async () => {
        try { await api("/products/" + id, { method: "DELETE" }); toast("Product deleted", "info"); await loadProducts(); renderAdmin(); }
        catch (e) { toast(e, "error"); }
    });
}
function openRestock(id) {
    const p = PRODUCTS.find((x) => x.id === id);
    openModal(`
        <div class="modal-head"><h2>Restock</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
        <p style="margin-bottom:12px">${p.name} — current stock <b>${p.stock}</b></p>
        <div class="form-row"><label>Add quantity</label><input id="rsQty" type="number" value="10"></div>
        <div class="form-row"><label>Note</label><input id="rsNote" placeholder="e.g. New supplier delivery"></div>
        <button class="btn-primary" onclick="doRestock(${id})"><i class="fas fa-boxes-stacked"></i> Add stock</button>
    `);
}
async function doRestock(id) {
    const qty = +$("rsQty").value;
    try {
        await api(`/products/${id}/restock`, { method: "POST", body: JSON.stringify({ qty, notes: $("rsNote").value }) });
        toast(`Restocked +${qty} ✅`, "success");
        closeModal(); await loadProducts(); renderAdmin();
    } catch (e) { toast(e, "error"); }
}

/* ---- Admin: flash deals ---- */
function renderAdminDeals() {
    const opts = PRODUCTS.map((p) => `<option value="${p.id}">${p.name} — ${money(p.price)}</option>`).join("");
    const rows = DEALS.length
        ? DEALS.map((p) => `<tr>
            <td><img src="${p.image}"></td>
            <td><b>${p.name}</b><br><small style="color:var(--muted)">${p.deal.label}</small></td>
            <td><span class="save-tag">-${p.deal.discount}%</span></td>
            <td>${money(p.deal_price)}<br><small style="color:var(--muted)"><s>${money(p.price)}</s></small></td>
            <td><small class="cd" data-ends="${p.deal.ends_at}">${cdText(p.deal.ends_at)}</small></td>
            <td><button class="tbtn del" title="End deal" onclick="deleteDeal(${p.deal_id})"><i class="fas fa-trash"></i></button></td>
        </tr>`).join("")
        : `<tr><td colspan="6" style="color:var(--muted)">No active deals. Create one below 👇</td></tr>`;
    $("apane-deals").innerHTML = `
        <div class="admin-bar"><h3>Active Flash Deals (${DEALS.length})</h3></div>
        <div class="table-scroll" style="margin-bottom:22px"><table class="admin-table">
            <thead><tr><th></th><th>Product</th><th>Off</th><th>Deal price</th><th>Ends in</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>
        <div class="glass card-pad" style="border-radius:16px">
            <h3 style="margin-bottom:14px"><i class="fas fa-bolt" style="color:var(--gold)"></i> Create a deal</h3>
            <div class="form-row"><label>Product</label><select id="dlProduct">${opts}</select></div>
            <div class="form-grid">
                <div class="form-row"><label>Discount %</label><input id="dlDiscount" type="number" value="25" min="1" max="90"></div>
                <div class="form-row"><label>Duration (days)</label><input id="dlDays" type="number" value="2" min="1"></div>
            </div>
            <div class="form-row"><label>Label</label>
                <select id="dlLabel">
                    <option>⚡ Flash Deal</option>
                    <option>🔥 Mega Deal</option>
                    <option>⏰ Today Only</option>
                    <option>💎 Clearance</option>
                    <option>✨ Weekend Loot</option>
                </select>
            </div>
            <button class="btn-add" onclick="createDeal()"><i class="fas fa-plus"></i> Launch deal</button>
        </div>`;
}
async function createDeal() {
    const body = {
        product_id: $("dlProduct").value,
        discount: $("dlDiscount").value,
        days: $("dlDays").value,
        label: $("dlLabel").value,
    };
    try {
        await api("/deals", { method: "POST", body: JSON.stringify(body) });
        toast("Flash deal launched! ⚡", "success");
        await loadProducts();
        renderAdmin();
    } catch (e) { toast(e, "error"); }
}
function deleteDeal(id) {
    confirmModal("End this deal?", "The product will return to its normal price.", async () => {
        try { await api("/deals/" + id, { method: "DELETE" }); toast("Deal ended", "info"); await loadProducts(); renderAdmin(); }
        catch (e) { toast(e, "error"); }
    });
}

function renderAdminInventory(stats) {
    const low = stats.low_stock;
    const moves = stats.movements;
    $("apane-inventory").innerHTML = `
        ${low.length ? `<div class="lowstock-warn"><i class="fas fa-triangle-exclamation"></i> ${low.length} product(s) at or below reorder level — restock soon!</div>` : ""}
        <h3 style="margin-bottom:12px">Low / Out of stock</h3>
        <div class="table-scroll" style="margin-bottom:24px"><table class="admin-table">
            <thead><tr><th>Product</th><th>Stock</th><th>Reorder</th><th>Action</th></tr></thead>
            <tbody>${low.length ? low.map((p)=>`<tr><td>${p.name}</td>
                <td class="stk ${p.stock<=0?'stk-out':'stk-low'}">${p.stock}</td><td>${p.reorder_level}</td>
                <td><button class="tbtn ok" onclick="openRestock(${p.id})"><i class="fas fa-plus"></i></button></td></tr>`).join("")
                : `<tr><td colspan="4" style="color:var(--good)">All products well stocked ✅</td></tr>`}</tbody>
        </table></div>
        <h3 style="margin-bottom:12px">Recent stock movements</h3>
        <div class="table-scroll"><table class="admin-table">
            <thead><tr><th>Product</th><th>Change</th><th>Type</th><th>When</th></tr></thead>
            <tbody>${moves.map((m)=>`<tr><td>${m.pname||'#'+m.product_id}</td>
                <td class="stk ${m.change>=0?'stk-ok':'stk-out'}">${m.change>=0?'+':''}${m.change}</td>
                <td>${m.type}</td><td><small style="color:var(--muted)">${m.created_at}</small></td></tr>`).join("")}</tbody>
        </table></div>`;
}

async function renderAdminOrders() {
    const orders = await api("/orders");
    $("apane-orders").innerHTML = `
        <h3 style="margin-bottom:12px">All orders (${orders.length})</h3>
        <div class="table-scroll"><table class="admin-table">
            <thead><tr><th>#</th><th>Customer</th><th>Items</th><th>Total</th><th>Date</th><th>Status</th></tr></thead>
            <tbody>${orders.length ? orders.map((o)=>`<tr>
                <td>#${o.id}</td><td>${o.customer_name}</td>
                <td>${o.items.reduce((s,i)=>s+i.qty,0)} item(s)</td>
                <td>${money(o.total)}</td><td><small style="color:var(--muted)">${o.created_at}</small></td>
                <td>${o.status === "Delivered"
                    ? `<span class="status-pill st-Delivered" title="Delivered orders are final"><i class="fas fa-lock"></i> Delivered</span>`
                    : `<select class="status-select" onchange="setOrderStatus(${o.id},this.value)">${STAGES.map((s)=>`<option ${s===o.status?'selected':''}>${s}</option>`).join("")}</select>`}</td></tr>`).join("") : `<tr><td colspan="6">No orders yet.</td></tr>`}</tbody>
        </table></div>`;
}
async function setOrderStatus(id, status) {
    try {
        await api(`/orders/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
        toast(`Order #${id} → ${status}`, "success");
        if (status === "Delivered") renderAdminOrders();   // lock the row (delivered is final)
    } catch (e) {
        toast(e, "error");
        renderAdminOrders();   // revert the dropdown to the real status
    }
}

async function renderAdminQueries() {
    const qs = await api("/queries");
    $("apane-queries").innerHTML = `
        <h3 style="margin-bottom:12px">Customer queries (${qs.length})</h3>
        ${qs.length ? qs.map((q)=>`<div class="query-item">
            <div class="qi-subj">${q.subject}<span class="status-pill ${q.status==='Resolved'?'st-Delivered':'st-Placed'}">${q.status}</span></div>
            <div class="qi-msg"><b>${q.user_name}:</b> ${q.message}</div>
            ${q.response ? `<div class="query-resp"><b>You replied:</b> ${q.response}</div>`
              : `<div style="display:flex;gap:8px;margin-top:8px">
                    <input id="resp${q.id}" placeholder="Type a reply..." style="flex:1;padding:9px 12px;border-radius:10px;border:1px solid var(--glass-border);background:var(--glass);color:var(--text);font-family:inherit">
                    <button class="btn-add" style="padding:9px 16px" onclick="respondQuery(${q.id})">Reply</button>
                 </div>`}
        </div>`).join("") : `<p style="color:var(--muted)">No queries yet.</p>`}`;
}
async function respondQuery(id) {
    const response = $("resp" + id).value.trim();
    if (!response) return;
    try { await api(`/queries/${id}/respond`, { method: "POST", body: JSON.stringify({ response }) }); toast("Reply sent ✅", "success"); renderAdminQueries(); }
    catch (e) { toast(e, "error"); }
}

/* ===================================================================
   MODAL / TOAST / CONFETTI HELPERS
=================================================================== */
function openModal(html, wide) {
    $("modalCard").className = "modal-card glass" + (wide ? " wide" : "");
    $("modalCard").innerHTML = html;
    $("modalHost").classList.add("show");
}
function closeModal() { $("modalHost").classList.remove("show"); }
$("modalHost") && ($("modalHost").addEventListener("click", (e) => { if (e.target.id === "modalHost") closeModal(); }));

function confirmModal(title, text, onYes) {
    openModal(`
        <div class="empty" style="padding:24px 10px">
            <i class="fas fa-triangle-exclamation" style="color:var(--warn);font-size:48px"></i>
            <h2 style="margin:12px 0 6px">${title}</h2>
            <p>${text}</p>
            <div style="display:flex;gap:10px;justify-content:center;margin-top:18px">
                <button class="close-x" style="width:auto;padding:0 22px;border-radius:12px" onclick="closeModal()">Cancel</button>
                <button class="btn-primary" id="confirmYes" style="width:auto;padding:12px 22px;background:linear-gradient(135deg,var(--bad),var(--accent))">Yes, delete</button>
            </div>
        </div>`);
    $("confirmYes").onclick = () => { closeModal(); onYes(); };
}

let toastTimer;
function toast(msg, type = "success") {
    const host = $("toastHost");
    const el = document.createElement("div");
    const icon = type === "error" ? "fa-circle-xmark" : type === "info" ? "fa-circle-info" : "fa-circle-check";
    el.className = "toast " + type;
    el.innerHTML = `<i class="fas ${icon}"></i><span>${msg}</span>`;
    host.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 350); }, 3000);
}

/* lightweight confetti */
function fireConfetti() {
    const c = $("confetti");
    c.style.display = "block";
    const ctx = c.getContext("2d");
    c.width = innerWidth; c.height = innerHeight;
    const colors = ["#ff2d6e", "#7c5cff", "#21d4fd", "#ffce4d", "#27e0a0"];
    let parts = Array.from({ length: 140 }, () => ({
        x: Math.random() * c.width, y: -20 - Math.random() * c.height,
        r: 4 + Math.random() * 6, c: colors[(Math.random() * colors.length) | 0],
        vy: 2 + Math.random() * 4, vx: -2 + Math.random() * 4, a: Math.random() * Math.PI,
    }));
    let frames = 0;
    (function loop() {
        ctx.clearRect(0, 0, c.width, c.height);
        parts.forEach((p) => {
            p.y += p.vy; p.x += p.vx; p.a += 0.1;
            ctx.fillStyle = p.c;
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
            ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.6); ctx.restore();
        });
        frames++;
        if (frames < 160) requestAnimationFrame(loop);
        else { ctx.clearRect(0, 0, c.width, c.height); c.style.display = "none"; }
    })();
}

/* ===================================================================
   INIT
=================================================================== */
async function init() {
    initTheme();
    initGateway();
    initSearch();
    // auto-login if token still valid
    if (TOKEN) {
        try {
            const r = await api("/me");
            if (r.user) {
                USER = r.user;
                $("gateway").classList.add("hidden");
                $("app").classList.remove("hidden");
                bootApp();
                return;
            }
        } catch (e) { localStorage.removeItem("lootlo_token"); TOKEN = null; }
    }
}
init();
