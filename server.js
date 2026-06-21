const express = require("express");
const http = require("http");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const socketio = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// Railway proxy fix
app.set("trust proxy", true);

app.use(express.json());

// normaliza rotas
app.use((req, res, next) => {
    req.url = req.url.replace(/\/{2,}/g, "/");
    next();
});

// debug
app.use((req, res, next) => {
    console.log("REQ =>", req.method, req.url);
    console.log("BODY =>", req.body);
    console.log("API KEY HEADER =>", req.headers["x-api-key"]);
    next();
});

const uploadBase = path.join(__dirname, "uploads");
const usersFile = path.join(__dirname, "users.json");

if (!fs.existsSync(uploadBase)) {
    fs.mkdirSync(uploadBase, { recursive: true });
}

if (!fs.existsSync(usersFile)) {
    fs.writeFileSync(usersFile, JSON.stringify({}));
}

function loadUsers() {
    try {
        const raw = fs.readFileSync(usersFile, "utf-8");
        if (!raw || raw.trim() === "") return {};
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function saveUsers(data) {
    fs.writeFileSync(usersFile, JSON.stringify(data, null, 2));
}

// API KEY 30 chars
function generateApiKey() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let key = "";

    for (let i = 0; i < 30; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return key;
}

function getUserByApiKey(apiKey) {
    const users = loadUsers();
    apiKey = String(apiKey || "").trim();

    for (const u in users) {
        if (String(users[u].apiKey).trim() === apiKey) {
            return { username: u, data: users[u] };
        }
    }

    return null;
}

function auth(req, res, next) {
    let apiKey = req.headers["x-api-key"];

    if (!apiKey) {
        return res.status(401).json({
            status: "error",
            message: "NO_API_KEY"
        });
    }

    apiKey = String(apiKey).trim();

    const user = getUserByApiKey(apiKey);

    if (!user) {
        return res.status(403).json({
            status: "error",
            message: "INVALID_API_KEY"
        });
    }

    req.user = user;
    next();
}

// AUTH (register + login)
app.post("/auth", (req, res) => {
    const username = req.body.username;

    if (!username) {
        return res.json({
            status: "error",
            message: "NO_USERNAME"
        });
    }

    const users = loadUsers();

    if (!users[username]) {
        const apiKey = generateApiKey();

        users[username] = {
            apiKey,
            createdAt: Date.now()
        };

        saveUsers(users);

        fs.mkdirSync(path.join(uploadBase, username, "uploads"), { recursive: true });

        return res.json({
            status: "ok",
            mode: "register",
            apiKey
        });
    }

    return res.json({
        status: "ok",
        mode: "login",
        apiKey: users[username].apiKey
    });
});

// upload storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(uploadBase, req.user.username, "uploads");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },

    filename: (req, file, cb) => {
        cb(null, Date.now() + "_" + file.originalname);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 1024 * 1024 * 500 }
});

// upload route
app.post("/upload", auth, upload.single("file"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            status: "error",
            message: "NO_FILE"
        });
    }

    const protocol =
        req.headers["x-forwarded-proto"] || "https";

    const host = req.headers.host;

    const fileUrl =
        protocol +
        "://" +
        host +
        "/uploads/" +
        req.user.username +
        "/uploads/" +
        req.file.filename;

    const response = {
        status: "ok",
        success: true,
        fileUrl
    };

    io.emit("file_uploaded", response);

    res.json(response);
});

// static
app.use("/uploads", express.static(uploadBase));

// Railway port fix
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("SERVER RUNNING ON " + PORT);
});
