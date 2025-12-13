// telegram.js
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import { getNotices } from "./index.js";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const token = process.env.TELEGRAM_TOKEN;
if (!token) {
  console.error("❌ TELEGRAM_TOKEN is not set in .env");
  process.exit(1);
}

const SUB_FILE = path.resolve("./subscribers.json");
// Auto-send interval (ms). Default 1 hour = 3600000
const AUTO_INTERVAL_MS = process.env.AUTO_INTERVAL_MS
  ? parseInt(process.env.AUTO_INTERVAL_MS, 10)
  : 3600000;

const bot = new TelegramBot(token, { polling: true });
console.log("✅ Telegram bot is running...");

async function readSubscribers() {
  try {
    const raw = await fs.readFile(SUB_FILE, "utf8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch (err) {
    // If file does not exist or invalid, create empty file
    if (err.code === "ENOENT") {
      await writeSubscribers([]);
      return [];
    } else {
      console.error("Error reading subscribers file:", err);
      return [];
    }
  }
}

async function writeSubscribers(arr) {
  try {
    await fs.writeFile(SUB_FILE, JSON.stringify(arr, null, 2), "utf8");
  } catch (err) {
    console.error("Error writing subscribers file:", err);
  }
}

async function addSubscriber(chatId) {
  const subs = await readSubscribers();
  if (!subs.includes(chatId)) {
    subs.push(chatId);
    await writeSubscribers(subs);
    return true;
  }
  return false;
}

async function removeSubscriber(chatId) {
  let subs = await readSubscribers();
  const before = subs.length;
  subs = subs.filter((c) => c !== chatId);
  if (subs.length !== before) {
    await writeSubscribers(subs);
    return true;
  }
  return false;
}

async function broadcastNotices(count = 5) {
  const subs = await readSubscribers();
  if (!subs || subs.length === 0) return;
  let text;
  try {
    text = await getNotices(count);
  } catch (err) {
    console.error("Error fetching notices for broadcast:", err);
    // Inform subs about failure
    for (const chatId of subs) {
      try {
        await bot.sendMessage(chatId, "Failed to fetch notices right now. I'll try again later.");
      } catch (err2) {
        console.error("Error sending error message to", chatId, err2);
      }
    }
    return;
  }

  for (const chatId of subs) {
    try {
      // chunk message if too large
      if (text.length <= 4000) {
        await bot.sendMessage(chatId, text);
      } else {
        // split by double newline into smaller parts
        const parts = text.match(/[\s\S]{1,3500}(?:\n\n|$)/g) || [text];
        for (const p of parts) {
          await bot.sendMessage(chatId, p);
        }
      }
    } catch (err) {
      console.error("Failed to send notices to", chatId, err);
    }
  }
}

/* ---------- Commands ---------- */

// /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `Hi ${msg.from.first_name || ""} 👋
I fetch the latest college notifications.

Commands:
/notices or /latest [n] - fetch latest n notices (default 5, max 10)
/subscribe - receive hourly automatic notifications
/unsubscribe - stop automatic notifications
/help - show help
/about - about this bot`
  );
});

// /help
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `Help:
/notices [n] or /latest [n] - Get latest n notices (default 5)
/subscribe - subscribe to hourly automated notices
/unsubscribe - unsubscribe from automated notices
/help - show this help
/about - info about this bot`
  );
});

// /about
bot.onText(/\/about/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `College Notices Bot
- Scrapes the college site and sends formatted notices.
- Auto-send interval: ${AUTO_INTERVAL_MS / 60000} minutes.
- Subscribe with /subscribe to receive hourly updates.`
  );
});

// /notices or /latest
bot.onText(/\/(?:notices|latest)(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const count = Math.min(10, Math.max(1, parseInt(match[1], 10) || 5));
  await bot.sendMessage(chatId, `Fetching latest ${count} notices… ⏳`);
  try {
    const text = await getNotices(count);
    if (text.length <= 4000) {
      await bot.sendMessage(chatId, text);
    } else {
      const parts = text.match(/[\s\S]{1,3500}(?:\n\n|$)/g) || [text];
      for (const p of parts) await bot.sendMessage(chatId, p);
    }
  } catch (err) {
    console.error("Error in /notices handler:", err);
    await bot.sendMessage(chatId, "Something went wrong while fetching notices. Try again later.");
  }
});

// /subscribe
bot.onText(/\/subscribe/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const added = await addSubscriber(chatId);
    if (added) {
      await bot.sendMessage(chatId, "✅ Subscribed to hourly notices. You'll get the next update within an hour.");
      // Optionally send immediate notice on subscribe:
      try {
        const text = await getNotices(5);
        await bot.sendMessage(chatId, text);
      } catch (err) {
        console.error("Error sending immediate notice on subscribe:", err);
      }
    } else {
      await bot.sendMessage(chatId, "You're already subscribed. ✅");
    }
  } catch (err) {
    console.error("Error in /subscribe:", err);
    await bot.sendMessage(chatId, "Failed to subscribe. Try again later.");
  }
});

// /unsubscribe
bot.onText(/\/unsubscribe/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const removed = await removeSubscriber(chatId);
    if (removed) {
      await bot.sendMessage(chatId, "✅ You have been unsubscribed from hourly notices.");
    } else {
      await bot.sendMessage(chatId, "You were not subscribed.");
    }
  } catch (err) {
    console.error("Error in /unsubscribe:", err);
    await bot.sendMessage(chatId, "Failed to unsubscribe. Try again later.");
  }
});

/* ---------- Auto broadcaster ---------- */

async function startAutoBroadcast() {
  // First-run: wait AUTO_INTERVAL_MS then run repeatedly
  console.log(`Auto broadcaster scheduled every ${AUTO_INTERVAL_MS / 60000} minutes.`);

  // Optionally run immediately on startup:
  // await broadcastNotices(5);

  setInterval(async () => {
    try {
      console.log("Auto-broadcast: fetching and sending notices to subscribers...");
      await broadcastNotices(5);
    } catch (err) {
      console.error("Auto-broadcast failed:", err);
    }
  }, AUTO_INTERVAL_MS);
}

startAutoBroadcast();
