const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MIN_DISTANCE_METERS = parseInt(process.env.MIN_DISTANCE_METERS) || 100;

// Stores last known location per device
const lastLocations = {};

// Calculate distance between two GPS points in meters
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

// Get human-readable address from coordinates
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

// Send a Telegram message
async function sendTelegram(message) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.error("Telegram error:", err.message);
  }
}

// Format time as IST
function getTime() {
  return new Date().toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// OwnTracks sends location to this endpoint
app.post("/location", async (req, res) => {
  const data = req.body;

  // OwnTracks format check
  if (!data || data._type !== "location") return res.json({ result: "ignored" });

  const deviceId = req.headers["x-limit-d"] || data.tid || "unknown-device";
  const lat = data.lat;
  const lon = data.lon;
  const acc = data.acc || "?";

  console.log(`📍 Location from ${deviceId}: ${lat}, ${lon} (accuracy: ${acc}m)`);

  const address = await reverseGeocode(lat, lon);
  const time = getTime();
  const mapsLink = `https://maps.google.com/?q=${lat},${lon}`;

  const prev = lastLocations[deviceId];

  if (!prev) {
    // First time we see this device
    lastLocations[deviceId] = { lat, lon, address };
    await sendTelegram(
      `📲 *${deviceId} is now being tracked*\n📍 Location: ${address}\n🕐 Time: ${time}\n🗺 [Open in Maps](${mapsLink})`
    );
  } else {
    const distance = getDistance(prev.lat, prev.lon, lat, lon);

    if (distance >= MIN_DISTANCE_METERS) {
      lastLocations[deviceId] = { lat, lon, address };
      await sendTelegram(
        `📍 *${deviceId} moved*\n\n` +
        `*From:* ${prev.address}\n` +
        `*To:* ${address}\n` +
        `📏 Distance: ${Math.round(distance)}m\n` +
        `🕐 Time: ${time}\n` +
        `🗺 [Open in Maps](${mapsLink})`
      );
    } else {
      console.log(`  → Only moved ${Math.round(distance)}m — below threshold, no alert sent`);
    }
  }

  res.json({ result: "ok" });
});

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "running",
    devices_tracked: Object.keys(lastLocations).length,
    devices: Object.keys(lastLocations),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Device tracker running on port ${PORT}`));
