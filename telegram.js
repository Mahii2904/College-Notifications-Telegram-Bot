// telegram.js

import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import { getNotices } from "./index.js";
import fs from "fs/promises";
import path from "path";
import express from "express";

dotenv.config();

/* -------------------- BASIC SETUP -------------------- */

const token = process.env.TELEGRAM_TOKEN;
if (!token) {
  console.error("❌ TELEGRAM_TOKEN is missing");
  process.exit(1);
}

const AUTO_INTERVAL_MS = process.env.AUTO_INTERVAL_MS
  ? parseInt(process.env.AUTO_INTERVAL_MS, 10)
  : 3600000; // 1 hour

const SUB_FILE = path.join(process.cwd(), "subscribers.json");
const LAST_FILE = path.join(process.cwd(), "last_notice.json");

const bot = new TelegramBot(token, { polling: true });
console.log("✅ Telegram bot started");

/* -------------------- KEEP ALIVE (FREE RENDER FIX) -------------------- */

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Telegram bot is alive 🚀");
});

app.listen(PORT, () => {
  console.log(`🌐 Keep-alive server running on port ${PORT}`);
});

/* -------------------- BOT COMMAND MENU -------------------- */

bot.setMyCommands([
  { command: "start", description: "Start the bot" },
  { command: "notices", description: "Get latest notices" },
  { command: "subscribe", description: "Get auto notifications" },
  { command: "unsubscribe", description: "Stop auto notifications" },
  { command: "help", description: "Help info" },
  { command: "about", description: "About this bot" },
]).catch(console.error);

/* -------------------- FILE HELPERS -------------------- */

async function readJSON(file, fallback) {
  try {
    const data = await fs.readFile(file, "utf8");
    return JSON.parse(data);
  } catch {
    await fs.writeFile(file, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

async function writeJSON(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

/* -------------------- SUBSCRIBER LOGIC -------------------- */

async function readSubscribers() {
  return await readJSON(SUB_FILE, []);
}

async function addSubscriber(chatId) {
  const subs = await readSubscribers();
  if (!subs.includes(chatId)) {
    subs.push(chatId);
    await writeJSON(SUB_FILE, subs);
    return true;
  }
  return false;
}

async function removeSubscriber(chatId) {
  const subs = await readSubscribers();
  const filtered = subs.filter((id) => id !== chatId);
  if (filtered.length !== subs.length) {
    await writeJSON(SUB_FILE, filtered);
    return true;
  }
  return false;
}

/* -------------------- LAST NOTICE TRACKING -------------------- */

async function getLastNotice() {
  const data = await readJSON(LAST_FILE, { last: "" });
  return data.last;
}

async function setLastNotice(value) {
  await writeJSON(LAST_FILE, { last: value });
}

/* -------------------- AUTO BROADCAST (ONLY NEW) -------------------- */

async function broadcastNewNotices(count = 5) {
  const subs = await readSubscribers();
  if (subs.length === 0) return;

  const notices = await getNotices(count);
  if (!notices || notices.length === 0) return;

  const lastSent = await getLastNotice();
  const newOnes = [];

  for (const notice of notices) {
    if (notice.text === lastSent) break;
    newOnes.push(notice);
  }

  if (newOnes.length === 0) {
    console.log("ℹ️ No new notices");
    return;
  }

  // Send oldest → newest
  newOnes.reverse();

  let message = "";
  newOnes.forEach((n, i) => {
    message += `${i + 1}. ${n.text}\n${n.link}\n\n`;
  });

  for (const chatId of subs) {
    try {
      await bot.sendMessage(chatId, message);
    } catch (err) {
      console.error("Send failed:", chatId);
    }
  }

  await setLastNotice(notices[0].text);
  console.log("📢 New notices sent");
}

/* -------------------- COMMAND HANDLERS -------------------- */

// /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `Hi ${msg.from.first_name || ""} 👋
I send college notices automatically.

Commands:
/notices [n] - latest notices
/subscribe - auto updates
/unsubscribe - stop updates
/help - help info`
  );
});

// /help
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `/notices [n] - Get latest notices
/subscribe - Get auto updates
/unsubscribe - Stop auto updates`
  );
});

// /about
bot.onText(/\/about/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `📢 College Notices Bot

This bot automatically fetches the latest notices from the official college website and delivers them directly on Telegram.

✨ Features:
• Instant notice fetch on demand
• Automatic updates at regular intervals
• Sends only NEW notices 
• Lightweight and reliable
`
  );
});

// /notices or /latest
bot.onText(/\/(?:notices|latest)(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const count = Math.min(10, Math.max(1, parseInt(match?.[1]) || 5));

  await bot.sendMessage(chatId, "Fetching notices… ⏳");

  try {
    const notices = await getNotices(count);
    let text = "";
    notices.forEach((n, i) => {
      text += `${i + 1}. ${n.text}\n${n.link}\n\n`;
    });
    await bot.sendMessage(chatId, text);
  } catch {
    await bot.sendMessage(chatId, "❌ Failed to fetch notices");
  }
});

// /subscribe
bot.onText(/\/subscribe/, async (msg) => {
  const chatId = msg.chat.id;
  const added = await addSubscriber(chatId);

  if (added) {
    await bot.sendMessage(chatId, "✅ Subscribed to auto notices");
    try {
      const notices = await getNotices(5);
      let text = "";
      notices.forEach((n, i) => {
        text += `${i + 1}. ${n.text}\n${n.link}\n\n`;
      });
      await bot.sendMessage(chatId, text);
    } catch {}
  } else {
    await bot.sendMessage(chatId, "You are already subscribed 👍");
  }
});

// /unsubscribe
bot.onText(/\/unsubscribe/, async (msg) => {
  const removed = await removeSubscriber(msg.chat.id);
  await bot.sendMessage(
    msg.chat.id,
    removed
      ? "❌ Unsubscribed successfully"
      : "You were not subscribed"
  );
});

/* -------------------- START AUTO LOOP -------------------- */

console.log(`⏰ Auto check every ${AUTO_INTERVAL_MS / 60000} minutes`);

setInterval(() => {
  broadcastNewNotices(5).catch(console.error);
}, AUTO_INTERVAL_MS);

