const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MIN_DISTANCE_METERS = parseInt(process.env.MIN_DISTANCE_METERS) || 100;

const lastLocations = {};

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function reverseGeocode(lat, lon) {
  try {
    const res = await axios.get(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
      { headers: { "User-Agent": "DeviceTracker/1.0" } }
    );
    const a = res.data.address;
    const parts = [
      a.road || a.pedestrian || a.footway,
      a.suburb || a.neighbourhood || a.village,
      a.city || a.town,
    ].filter(Boolean);
    return parts.join(", ") || res.data.display_name.split(",").slice(0, 2).join(",");
  } catch {
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
}

async function sendTelegram(message) {
  try {
    console.log("Sending Telegram message...");
    console.log("Token:", TELEGRAM_TOKEN ? "SET" : "NOT SET");
    console.log("Chat ID:", TELEGRAM_CHAT_ID ? "SET" : "NOT SET");
    const res = await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
    });
    console.log("Telegram response:", res.data.ok ? "SUCCESS" : "FAILED");
  } catch (err) {
    console.error("Telegram error:", err.response ? JSON.stringify(err.response.data) : err.message);
  }
}

function getTime() {
  return new Date().toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

app.post("/location", async (req, res) => {
  const data = req.body;

  console.log("=== INCOMING REQUEST ===");
  console.log("Headers:", JSON.stringify(req.headers));
  console.log("Body:", JSON.stringify(data));
  console.log("========================");

  if (!data || data._type !== "location") {
    console.log("Ignored - not a location type. _type was:", data ? data._type : "no data");
    return res.json({ result: "ignored" });
  }

  const deviceId = req.headers["x-limit-d"] || data.tid || data.topic || "unknown-device";
  const lat = data.lat;
  const lon = data.lon;

  console.log(`Location from ${deviceId}: ${lat}, ${lon}`);

  const address = await reverseGeocode(lat, lon);
  const time = getTime();
  const mapsLink = `https://maps.google.com/?q=${lat},${lon}`;
  const prev = lastLocations[deviceId];

  if (!prev) {
    lastLocations[deviceId] = { lat, lon, address };
    await sendTelegram(
      `📲 *${deviceId} is now being tracked*\n📍 Location: ${address}\n🕐 Time: ${time}\n🗺 [Open in Maps](${mapsLink})`
    );
  } else {
    const distance = getDistance(prev.lat, prev.lon, lat, lon);
    console.log(`Distance moved: ${Math.round(distance)}m`);
    lastLocations[deviceId] = { lat, lon, address };
    await sendTelegram(
      `📍 *${deviceId} location update*\n📍 ${address}\n🕐 Time: ${time}\n🗺 [Open in Maps](${mapsLink})`
    );
  }

  res.json({ result: "ok" });
});

app.get("/", (req, res) => {
  res.json({
    status: "running",
    devices_tracked: Object.keys(lastLocations).length,
    devices: Object.keys(lastLocations),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Device tracker running on port ${PORT}`));
