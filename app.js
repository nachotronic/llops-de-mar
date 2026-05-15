document.addEventListener("DOMContentLoaded", () => {
  const SANT_FELIU = { lat: 41.781, lon: 3.0345 };
  let selectedSessionTime = "08:00";
  let selectedSessionDay = 1;
  let cachedWeatherData = null;
  let map = null;

  function initMap() {
    const mapElement = document.getElementById("map");
    if (!mapElement || typeof L === "undefined") return;

    const isDesktopMap = window.matchMedia("(min-width: 901px)").matches;
    const initialZoom = isDesktopMap ? 14 : 13;

    map = L.map("map", {
      scrollWheelZoom: false,
      zoomControl: false,
      doubleClickZoom: false,
      touchZoom: false,
      boxZoom: false,
      keyboard: false
    }).setView([41.780, 3.034], initialZoom);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", {
      subdomains: "abcd",
      maxZoom: 20,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
    }).addTo(map);

    setTimeout(() => map.invalidateSize(), 250);
    setTimeout(() => map.invalidateSize(), 900);
  }

  function directionName(deg) {
    const directions = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
    return directions[Math.round(deg / 45) % 8];
  }

  function capitalizeWords(text) {
    return text.split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  }

  function windNameCatalan(deg) {
    const names = ["Tramuntana", "Gregal", "Llevant", "Xaloc", "Migjorn", "Garbí", "Ponent", "Mestral"];
    return names[Math.round(deg / 45) % 8];
  }

  function windLabel(deg) {
    return `${windNameCatalan(deg)} · ${directionName(deg)}`;
  }

  function formatUpdated(date) {
    const formatted = date.toLocaleString("ca-ES", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    return capitalizeWords(formatted);
  }

  function formatSessionDate(date) {
    const formatted = date.toLocaleDateString("ca-ES", { weekday: "long", day: "2-digit", month: "long" });
    return capitalizeWords(formatted);
  }

  function formatShortTime(isoString) {
    if (!isoString) return "--";
    return new Date(isoString).toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit" });
  }

  function parseSessionTime(timeString) {
    const [hour, minute] = timeString.split(":").map(Number);
    return { hour, minute };
  }

  function nextSessionDate(timeString, selectedDay) {
    const now = new Date();
    const { hour, minute } = parseSessionTime(timeString);

    for (let offset = 0; offset < 10; offset++) {
      const date = new Date(now);
      date.setDate(now.getDate() + offset);
      date.setHours(hour, minute, 0, 0);
      if (date.getDay() === selectedDay && date >= now) return date;
    }

    return now;
  }

  function findClosestForecast(hourly, targetDate) {
    let closestIndex = 0;
    let closestDistance = Infinity;

    hourly.time.forEach((time, index) => {
      const distance = Math.abs(new Date(time) - targetDate);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    return {
      time: hourly.time[closestIndex],
      temp: hourly.temperature_2m[closestIndex],
      apparentTemp: hourly.apparent_temperature?.[closestIndex],
      rain: hourly.rain[closestIndex],
      wind: hourly.wind_speed_10m[closestIndex],
      direction: hourly.wind_direction_10m[closestIndex]
    };
  }

  function findClosestMarineForecast(hourly, targetDate) {
    if (!hourly || !hourly.time) return null;

    let closestIndex = 0;
    let closestDistance = Infinity;

    hourly.time.forEach((time, index) => {
      const distance = Math.abs(new Date(time) - targetDate);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    return {
      waveHeight: hourly.wave_height?.[closestIndex],
      wavePeriod: hourly.wave_period?.[closestIndex],
      waveDirection: hourly.wave_direction?.[closestIndex]
    };
  }

  function findDailySun(daily, targetDate) {
    if (!daily || !daily.time) return null;
    const targetDay = targetDate.toISOString().slice(0, 10);
    const index = daily.time.findIndex(day => day === targetDay);
    if (index === -1) return null;
    return { sunrise: daily.sunrise?.[index], sunset: daily.sunset?.[index] };
  }

  function seaStateLabel(waveHeight) {
    if (waveHeight == null || Number.isNaN(waveHeight)) return "Mar sense dades";
    if (waveHeight < .2) return "Mar plana";
    if (waveHeight < .5) return "Marejol";
    if (waveHeight < 1.25) return "Maror";
    if (waveHeight < 2.5) return "Forta maror";
    return "Maregassa";
  }

  function waveDirectionLabel(deg) {
    if (deg == null || Number.isNaN(deg)) return "direcció sense dades";
    return `${windNameCatalan(deg)} · ${directionName(deg)}`;
  }

  function waveArrowHTML(deg) {
    if (deg == null || Number.isNaN(deg)) return "";
    return `<span class="wave-arrow-inline" style="transform: rotate(${deg}deg)" aria-hidden="true">↑</span>`;
  }

  function marineComment(marine) {
    if (!marine || marine.waveHeight == null) return "No hi ha dades d'onatge per a aquesta hora.";

    const directionText = marine.waveDirection != null
      ? ` Onatge de ${waveDirectionLabel(marine.waveDirection)}.`
      : "";

    if (marine.waveHeight >= 1.25) return `Onatge important: convé evitar sortir o mantenir-se en una zona molt protegida.${directionText}`;
    if (marine.waveHeight >= .7) return `Onatge moderat: valoreu la sortida segons el nivell del grup i l'estat real de la badia.${directionText}`;
    if (marine.waveHeight >= .35) return `Una mica d'onatge: sortida possible, però cal vigilar l'entrada i la sortida de l'aigua.${directionText}`;
    return `Mar força tranquil·la segons la previsió d'onatge.${directionText}`;
  }

  function lightsComment(targetDate, sun) {
    if (!sun?.sunset) return "";
    const sunsetDate = new Date(sun.sunset);
    const minutesToSunset = Math.round((sunsetDate - targetDate) / 60000);

    if (minutesToSunset <= 90 && minutesToSunset >= -30) {
      return "Sortida propera a la posta de sol: cal portar llums i tenir-les a punt abans que baixi la llum.";
    }

    if (minutesToSunset < -30) {
      return "Sortida després de la posta de sol: cal sortir amb llums.";
    }

    return "";
  }

  function rowingRecommendation({ wind, rain }, marine) {
    const waveHeight = marine?.waveHeight ?? 0;
    if (wind >= 45 || rain >= 12 || waveHeight >= 2.5 || (wind >= 35 && rain >= 5)) return { text: "Millor ajornar la sortida", color: "#b91c1c" };
    if (wind >= 30 || rain >= 5 || waveHeight >= 1.25) return { text: "Quedar-se dins la badia", color: "#b7791f" };
    if (wind >= 18 || rain >= .8 || waveHeight >= .7) return { text: "Sortida amb precaució", color: "#b7791f" };
    return { text: "Bones condicions", color: "#16803c" };
  }

  function sessionAlert({ wind, rain }, marine) {
    const alerts = [];
    if (rain >= 3) alerts.push("pluja prevista");
    if (wind >= 30) alerts.push("vent fort");
    if (marine && marine.waveHeight >= 1.25) alerts.push("onatge important");
    return alerts.length ? `Avís per al grup: ${alerts.join(", ")}. Reviseu l'estat real abans de sortir.` : "";
  }

  function forecastComment({ wind, rain }) {
    if (rain >= 5 && wind >= 30) return "Pluja intensa i vent fort: millor ajornar la sortida i revisar l'evolució del temps. Si finalment sortiu, és recomanable quedar-se dins la badia.";
    if (wind >= 35) return "Vent molt fort: condicions poc recomanables per sortir a remar. Si finalment sortiu, és recomanable quedar-se dins la badia.";
    if (rain >= 5) return "Pluja abundant prevista: sortida incòmoda i amb visibilitat reduïda. Si finalment sortiu, és recomanable quedar-se dins la badia.";
    if (wind >= 30) return "Vent fort: cal molta prudència. És recomanable quedar-se dins la badia i evitar zones més exposades.";
    if (rain >= 3) return "Pluja notable: valoreu si compensa sortir i porteu roba adequada. Si sortiu, és recomanable quedar-se dins la badia.";
    if (wind >= 18 && rain >= .8) return "Vent moderat i possibilitat de pluja: sortida possible, però amb precaució. És millor quedar-se dins la badia.";
    if (wind >= 18) return "Vent moderat: bona idea quedar-se dins la badia o a prop de la costa i revisar l'estat real de la mar.";
    if (rain >= .8) return "Pot ploure una mica: sortida possible, però convé anar preparats.";
    if (wind <= 8 && rain < .2) return "Vent fluix i gairebé sense pluja: bones condicions per remar amb calma.";
    return "Condicions en principi favorables, sempre revisant l'estat real de la mar abans de sortir.";
  }

  function windVisualConfig(speed) {
    if (speed < 10) return { color: "#008fa3", count: 60, opacity: 0.58, duration: 5.6 };
    if (speed < 18) return { color: "#164782", count: 80, opacity: 0.68, duration: 4.8 };
    if (speed < 25) return { color: "#e85d04", count: 100, opacity: 0.76, duration: 4.0 };
    return { color: "#be123c", count: 120, opacity: 0.84, duration: 3.3 };
  }

  function buildWindStreams(count, duration) {
    const layer = document.getElementById("windStreamLayer");
    if (!layer) return;
    layer.innerHTML = "";

    const cols = 18;
    const rows = Math.ceil(count / cols);

    for (let i = 0; i < count; i++) {
      const el = document.createElement("span");
      el.className = "wind-stream";

      const col = i % cols;
      const row = Math.floor(i / cols);
      const usableWidth = 96;
      const usableHeight = 90;
      const leftStart = 1;
      const topStart = 3;
      const leftStep = usableWidth / Math.max(cols - 1, 1);
      const topStep = usableHeight / Math.max(rows - 1, 1);
      const leftJitter = ((i * 13) % 5) - 2;
      const topJitter = ((i * 17) % 5) - 2;

      el.style.left = `${leftStart + col * leftStep + leftJitter}%`;
      el.style.top = `${topStart + row * topStep + topJitter}%`;
      el.style.animationDelay = `${-(i * 0.06)}s`;
      el.style.animationDuration = `${duration + (i % 4) * 0.08}s`;
      el.style.scale = `${0.9 + (i % 3) * 0.05}`;
      layer.appendChild(el);
    }
  }

  function updateWindOverlay(speed, direction) {
    const layer = document.getElementById("windStreamLayer");
    const layerShell = layer?.closest(".wind-stream-layer");
    if (!layer || !layerShell) return;

    const baseConfig = windVisualConfig(speed);
    const isMobile = window.matchMedia("(max-width: 900px)").matches;
    if (isMobile) return;

    const rotation = direction + 90;
    layerShell.classList.add("is-fading");

    window.setTimeout(() => {
      layer.style.setProperty("--wind-color", baseConfig.color);
      layer.style.setProperty("--wind-opacity", baseConfig.opacity);
      layer.style.setProperty("--wind-angle", `${rotation}deg`);
      buildWindStreams(baseConfig.count, baseConfig.duration);
      requestAnimationFrame(() => layerShell.classList.remove("is-fading"));
    }, 280);
  }

  function updateSessionForecast(data) {
    cachedWeatherData = data;
    const weatherHourly = data.weather.hourly;
    const marineHourly = data.marine?.hourly;
    const weatherDaily = data.weather.daily;
    const targetDate = nextSessionDate(selectedSessionTime, selectedSessionDay);
    const session = findClosestForecast(weatherHourly, targetDate);
    const marine = findClosestMarineForecast(marineHourly, targetDate);
    const sun = findDailySun(weatherDaily, targetDate);
    const status = rowingRecommendation(session, marine);
    const comment = forecastComment(session);
    const seaComment = marineComment(marine);
    const lightComment = lightsComment(targetDate, sun);
    const alertText = sessionAlert(session, marine);
    const rotation = session.direction + 180;

    document.getElementById("sessionSummary").innerHTML = `
      <strong>${formatSessionDate(targetDate)} · ${selectedSessionTime}</strong>
      <span class="forecast-used">Previsió més propera: ${formatShortTime(session.time)}</span>
      <span class="status-line"><span class="status-dot" style="background:${status.color}"></span>${status.text}</span>
      <div class="session-meta">
        <span class="meta-pill">🌡️ ${Math.round(session.temp)} °C</span>
        <span class="meta-pill">Sensació ${session.apparentTemp != null ? Math.round(session.apparentTemp) + " °C" : "--"}</span>
        <span class="meta-pill">🌧️ ${session.rain.toFixed(1)} mm</span>
        <span class="meta-pill sea-pill">🌊 ${marine && marine.waveHeight != null ? marine.waveHeight.toFixed(1) + " m" : "--"} · ${marine ? seaStateLabel(marine.waveHeight) : "Mar sense dades"}${marine?.waveDirection != null ? " · " + waveArrowHTML(marine.waveDirection) + " " + waveDirectionLabel(marine.waveDirection) : ""}</span>
      </div>
      <div class="mini-wind-card">
        <div class="mini-compass" aria-label="Direcció del vent">
          <span class="mini-compass-arrow-wrap" id="windArrowInline">
            <svg class="mini-compass-arrow" viewBox="0 0 64 64" aria-hidden="true">
              <path fill="currentColor" d="M32 4l15 38-15-8-15 8L32 4z"></path>
              <path fill="currentColor" opacity=".35" d="M28 32h8v24h-8z"></path>
            </svg>
          </span>
        </div>
        <div class="mini-wind-info">
          <strong>${Math.round(session.wind)} km/h</strong>
          <span>${windLabel(session.direction)}</span>
          <div class="forecast-comment">${comment}<br>${seaComment}${lightComment ? `<br>${lightComment}` : ""}</div>
          ${alertText ? `<div class="forecast-alert">${alertText}</div>` : ""}
        </div>
      </div>
      <div class="sun-info">
        <span>🌅 Sortida ${formatShortTime(sun?.sunrise)}</span>
        <span>🌇 Posta ${formatShortTime(sun?.sunset)}</span>
      </div>
    `;

    const inlineArrow = document.getElementById("windArrowInline");
    if (inlineArrow) inlineArrow.style.transform = `rotate(${rotation}deg)`;
    updateWindOverlay(session.wind, session.direction);
  }

  function syncControls() {
    document.querySelectorAll(".day-btn").forEach(btn => {
      btn.classList.toggle("active", Number(btn.dataset.day) === selectedSessionDay);
    });
    document.querySelectorAll(".session-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.time === selectedSessionTime);
    });
  }

  function attachControlEvents() {
    document.querySelectorAll(".day-btn").forEach(button => {
      button.addEventListener("click", () => {
        selectedSessionDay = Number(button.dataset.day);
        syncControls();
        if (cachedWeatherData) updateSessionForecast(cachedWeatherData);
        if (map) setTimeout(() => map.invalidateSize(), 100);
      });
    });

    document.querySelectorAll(".session-btn").forEach(button => {
      button.addEventListener("click", () => {
        selectedSessionTime = button.dataset.time;
        syncControls();
        if (cachedWeatherData) updateSessionForecast(cachedWeatherData);
        if (map) setTimeout(() => map.invalidateSize(), 100);
      });
    });
  }

  async function loadWeather() {
    const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
    weatherUrl.search = new URLSearchParams({
      latitude: SANT_FELIU.lat,
      longitude: SANT_FELIU.lon,
      hourly: "temperature_2m,apparent_temperature,rain,wind_speed_10m,wind_direction_10m",
      daily: "sunrise,sunset",
      forecast_days: "7",
      timezone: "Europe/Madrid",
      wind_speed_unit: "kmh"
    });

    const marineUrl = new URL("https://marine-api.open-meteo.com/v1/marine");
    marineUrl.search = new URLSearchParams({
      latitude: 41.776,
      longitude: 3.045,
      hourly: "wave_height,wave_direction,wave_period",
      forecast_days: "7",
      timezone: "Europe/Madrid"
    });

    try {
      const [weatherResponse, marineResponse] = await Promise.all([fetch(weatherUrl), fetch(marineUrl)]);
      if (!weatherResponse.ok) throw new Error("No s'ha pogut carregar la previsió meteorològica");

      const weather = await weatherResponse.json();
      const marine = marineResponse.ok ? await marineResponse.json() : null;

      document.getElementById("updatedAt").textContent = `Actualitzat: ${formatUpdated(new Date())}`;
      updateSessionForecast({ weather, marine });
    } catch (error) {
      document.getElementById("updatedAt").textContent = "No s'ha pogut carregar la previsió.";
      document.getElementById("sessionSummary").textContent = "Hi ha hagut un problema carregant les dades meteorològiques.";
      console.error(error);
    }
  }

  function runSmokeTests() {
    console.assert(Boolean(document.getElementById("map")), "Falta #map");
    console.assert(directionName(0) === "N", "directionName(0) debería ser N");
    console.assert(windNameCatalan(225) === "Garbí", "225° debería ser Garbí");
    console.assert(nextSessionDate("08:00", 1) instanceof Date, "nextSessionDate debería devolver Date");
  }

  runSmokeTests();
  attachControlEvents();
  syncControls();
  initMap();
  loadWeather();
  window.setInterval(loadWeather, 30 * 60 * 1000);

  window.addEventListener("resize", () => {
    if (map) setTimeout(() => map.invalidateSize(), 150);
  });
});
