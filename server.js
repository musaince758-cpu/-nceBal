import express from "express";
import helmet from "helmet";
import dotenv from "dotenv";
import crypto from "crypto";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const db = new Database("ince-bal.sqlite");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment',
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  postal_code TEXT,
  total REAL NOT NULL,
  payment_token TEXT,
  payment_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id)
);
`);

const products = [
  { id:"cicek-850", name:"Çiçek Balı", size:"850 g", price:349.90, badge:"%100 Doğal", image:"/images/cicek-bal.svg" },
  { id:"cam-850", name:"Çam Balı", size:"850 g", price:399.90, badge:"%100 Doğal", image:"/images/cam-bal.svg" },
  { id:"yayla-850", name:"Yayla Balı", size:"850 g", price:369.90, badge:"%100 Doğal", image:"/images/yayla-bal.svg" },
  { id:"ozel-450", name:"Özel Seri Bal", size:"450 g", price:499.90, badge:"Premium", image:"/images/ozel-bal.svg" }
];

app.get("/api/products", (_, res) => res.json(products));

function money(n) {
  return Number(Number(n).toFixed(2));
}

function orderNo() {
  return "IB" + new Date().toISOString().slice(0,10).replaceAll("-","") + "-" +
    crypto.randomBytes(3).toString("hex").toUpperCase();
}

function iyzicoAuth(apiKey, secretKey, uriPath, body) {
  const randomKey = Date.now().toString() + crypto.randomInt(100000, 999999).toString();
  const signature = crypto.createHmac("sha256", secretKey)
    .update(randomKey + uriPath + body)
    .digest("hex");
  const authorizationString =
    `apiKey:${apiKey}&randomKey:${randomKey}&signature:${signature}`;
  return {
    authorization: "IYZWSv2 " + Buffer.from(authorizationString, "utf8").toString("base64"),
    randomKey
  };
}

async function iyzicoPost(uriPath, payload) {
  const body = JSON.stringify(payload);
  const { authorization, randomKey } = iyzicoAuth(
    process.env.IYZICO_API_KEY,
    process.env.IYZICO_SECRET_KEY,
    uriPath,
    body
  );
  const response = await fetch((process.env.IYZICO_BASE_URL || "https://api.iyzipay.com") + uriPath, {
    method: "POST",
    headers: {
      "Authorization": authorization,
      "x-iyzi-rnd": randomKey,
      "Content-Type": "application/json"
    },
    body
  });
  return await response.json();
}

app.post("/api/checkout", async (req, res) => {
  try {
    const { customer, items } = req.body;
    if (!customer || !items?.length) return res.status(400).json({ error:"Sepet boş." });

    const normalized = items.map(i => {
      const p = products.find(x => x.id === i.id);
      if (!p) throw new Error("Geçersiz ürün.");
      const quantity = Math.max(1, Math.min(20, Number(i.quantity || 1)));
      return { ...p, quantity };
    });

    const subtotal = money(normalized.reduce((s,i) => s + i.price * i.quantity, 0));
    const shipping = subtotal >= Number(process.env.FREE_SHIPPING_LIMIT || 1000)
      ? 0 : Number(process.env.SHIPPING_PRICE || 89.90);
    const total = money(subtotal + shipping);
    const no = orderNo();

    const insertOrder = db.prepare(`
      INSERT INTO orders(order_no, customer_name, email, phone, address, city, postal_code, total)
      VALUES(?,?,?,?,?,?,?,?)
    `);
    const info = insertOrder.run(
      no, customer.name, customer.email, customer.phone,
      customer.address, customer.city, customer.postalCode || "", total
    );

    const insertItem = db.prepare(`
      INSERT INTO order_items(order_id, product_id, product_name, quantity, unit_price)
      VALUES(?,?,?,?,?)
    `);
    const addItems = db.transaction(rows => rows.forEach(i =>
      insertItem.run(info.lastInsertRowid, i.id, i.name, i.quantity, i.price)
    ));
    addItems(normalized);

    if (!process.env.IYZICO_API_KEY || !process.env.IYZICO_SECRET_KEY) {
      return res.status(503).json({
        error:"Ödeme altyapısı henüz yapılandırılmadı.",
        orderNo:no,
        setupRequired:true
      });
    }

    const baseUrl = process.env.BASE_URL;
    const buyer = {
      id: no,
      name: customer.name.split(" ")[0] || customer.name,
      surname: customer.name.split(" ").slice(1).join(" ") || "-",
      email: customer.email,
      gsmNumber: customer.phone,
      registrationAddress: customer.address,
      city: customer.city,
      country: "Turkey",
      zipCode: customer.postalCode || "34000",
      ip: req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "127.0.0.1"
    };

    const address = {
      address: customer.address,
      zipCode: customer.postalCode || "34000",
      contactName: customer.name,
      city: customer.city,
      country: "Turkey"
    };

    const payload = {
      locale:"tr",
      conversationId:no,
      price:total.toFixed(2),
      paidPrice:total.toFixed(2),
      currency:"TRY",
      basketId:no,
      paymentGroup:"PRODUCT",
      callbackUrl:`${baseUrl}/payment/callback`,
      enabledInstallments:[1,2,3,6,9],
      buyer,
      shippingAddress:address,
      billingAddress:address,
      basketItems: normalized.map(i => ({
        id:i.id,
        name:i.name,
        category1:"Bal",
        itemType:"PHYSICAL",
        price:(i.price*i.quantity).toFixed(2)
      }))
    };

    const result = await iyzicoPost(
      "/payment/iyzipos/checkoutform/initialize/auth/ecom",
      payload
    );

    if (result.status !== "success") {
      db.prepare("UPDATE orders SET status=? WHERE id=?").run("payment_error", info.lastInsertRowid);
      return res.status(502).json({ error: result.errorMessage || "Ödeme başlatılamadı." });
    }

    db.prepare("UPDATE orders SET payment_token=? WHERE id=?")
      .run(result.token, info.lastInsertRowid);

    res.json({
      orderNo:no,
      paymentPageUrl:result.paymentPageUrl,
      checkoutFormContent:result.checkoutFormContent,
      token:result.token
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Beklenmeyen bir hata oluştu." });
  }
});

app.post("/payment/callback", async (req, res) => {
  try {
    const token = req.body.token || req.query.token;
    if (!token) return res.status(400).send("Token bulunamadı.");
    if (!process.env.IYZICO_API_KEY || !process.env.IYZICO_SECRET_KEY) {
      return res.status(503).send("Ödeme altyapısı yapılandırılmadı.");
    }

    const result = await iyzicoPost(
      "/payment/iyzipos/checkoutform/auth/ecom/detail",
      { locale:"tr", conversationId:"callback", token }
    );

    const order = db.prepare("SELECT * FROM orders WHERE payment_token=?").get(token);
    if (order) {
      const status = result.paymentStatus === "SUCCESS" && Number(result.fraudStatus) === 1
        ? "paid" : "payment_review";
      db.prepare("UPDATE orders SET status=?, payment_id=? WHERE id=?")
        .run(status, result.paymentId || null, order.id);
      return res.redirect(`/success.html?order=${encodeURIComponent(order.order_no)}`);
    }
    res.status(404).send("Sipariş bulunamadı.");
  } catch (err) {
    console.error(err);
    res.status(500).send("Ödeme sonucu işlenemedi.");
  }
});

app.get("/api/order/:orderNo", (req,res) => {
  const order = db.prepare("SELECT order_no,status,total,created_at FROM orders WHERE order_no=?")
    .get(req.params.orderNo);
  if (!order) return res.status(404).json({error:"Sipariş bulunamadı."});
  res.json(order);
});

app.get("*", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`İnce Bal çalışıyor: http://localhost:${port}`));
