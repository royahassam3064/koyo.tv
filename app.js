"use strict";

const CONFIG = window.KOYO_CONFIG;
const API_BASE = CONFIG.API_BASE.replace(/\/+$/, "");

const $ = id => document.getElementById(id);

let liveChannels = [];
let movies = [];
let series = [];

const imageFallback =
  "data:image/svg+xml," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="200">
      <rect width="100%" height="100%" fill="#1b1c2b"/>
      <text x="50%" y="50%" fill="#9575ff"
        font-size="30" text-anchor="middle"
        dominant-baseline="middle">KOYO TV</text>
    </svg>
  `);

function showError(message) {
  $("loadingText").textContent = "تعذر تحميل الاشتراك";
  $("errorBox").hidden = false;
  $("errorBox").textContent = message;
  $("retryBtn").hidden = false;
}

function setLoading(message) {
  $("errorBox").hidden = true;
  $("retryBtn").hidden = true;
  $("loadingText").textContent = message;
}

async function request(params = {}) {
  const url = new URL(API_BASE + "/api/xtream");

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store"
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        "خطأ من الخادم: HTTP " + response.status +
        (text ? " - " + text.slice(0, 180) : "")
      );
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error("الخادم لم يرجع بيانات JSON صحيحة.");
    }

  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("انتهت مهلة الاتصال. حاول مرة ثانية.");
    }

    if (error instanceof TypeError) {
      throw new Error(
        "تعذر الاتصال بـCloudflare Worker. تحقق من الرابط والإنترنت."
      );
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}

function validAccount(data) {
  const info = data?.user_info;

  if (!info) {
    throw new Error("بيانات الحساب غير صحيحة أو رد الخادم غير متوقع.");
  }

  if (String(info.auth) !== "1") {
    throw new Error("بيانات الاشتراك غير صحيحة أو الاشتراك غير مفعّل.");
  }

  if (String(info.status || "").toLowerCase() === "expired") {
    throw new Error("انتهت صلاحية الاشتراك.");
  }

  return info;
}

async function loadEverything() {
  try {
    if (!CONFIG?.API_BASE) {
      throw new Error("رابط API_BASE غير موجود في config.js.");
    }

    setLoading("جاري التحقق من الاشتراك...");

    const account = await request();
    validAccount(account);

    setLoading("تم التحقق. جاري تحميل المحتوى...");

    const results = await Promise.allSettled([
      request({ action: "get_live_streams" }),
      request({ action: "get_vod_streams" }),
      request({ action: "get_series" })
    ]);

    if (results.every(result => result.status === "rejected")) {
      throw new Error(
        "فشل تحميل جميع الأقسام: " +
        results.map(r => r.reason.message).join(" | ")
      );
    }

    liveChannels = results[0].status === "fulfilled"
      ? results[0].value : [];

    movies = results[1].status === "fulfilled"
      ? results[1].value : [];

    series = results[2].status === "fulfilled"
      ? results[2].value : [];

    if (!Array.isArray(liveChannels) ||
        !Array.isArray(movies) ||
        !Array.isArray(series)) {
      throw new Error("صيغة البيانات المستلمة غير صحيحة.");
    }

    liveChannels = liveChannels.filter(channel =>
      String(channel.name || "").startsWith("AR |")
    );

    renderAll();

    $("loader").hidden = true;
    $("app").hidden = false;

  } catch (error) {
    showError(error.message || "حدث خطأ غير معروف.");
  }
}

function safeImage(url) {
  if (!url) return imageFallback;

  try {
    const parsed = new URL(url);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return imageFallback;
    }

    return parsed.href;
  } catch {
    return imageFallback;
  }
}

function createCard(item, type) {
  const title = item.name || "بدون اسم";

  const image = type === "live"
    ? item.stream_icon
    : item.cover || item.stream_icon;

  const card = document.createElement("article");
  card.className = "content-card";

  const img = document.createElement("img");
  img.src = safeImage(image);
  img.alt = title;
  img.loading = "lazy";
  img.onerror = () => {
    img.src = imageFallback;
  };

  const info = document.createElement("div");
  info.className = "card-info";

  const strong = document.createElement("strong");
  strong.textContent = title;

  const small = document.createElement("small");
  small.textContent =
    type === "live" ? "بث مباشر" :
    type === "movie" ? "فيلم" : "مسلسل";

  info.append(strong, small);
  card.append(img, info);

  card.addEventListener("click", () => {
    if (type === "live") {
      playContent(title, liveUrl(item));
    } else if (type === "movie") {
      playContent(title, movieUrl(item));
    } else {
      openSeries(item);
    }
  });

  return card;
}

function streamUrl(type, id, ext) {
  return API_BASE + "/stream/" +
    encodeURIComponent(type) + "/" +
    encodeURIComponent(id) + "." +
    encodeURIComponent(ext);
}

function liveUrl(item) {
  return streamUrl("live", item.stream_id, "ts");
}

function movieUrl(item) {
  return streamUrl(
    "movie",
    item.stream_id,
    item.container_extension || "mp4"
  );
}

function fillGrid(containerId, items, type, limit = Infinity) {
  const container = $(containerId);
  container.replaceChildren();

  const selected = items.slice(0, limit);

  if (!selected.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "لا يوجد محتوى متاح حالياً.";
    container.append(empty);
    return;
  }

  selected.forEach(item => {
    container.append(createCard(item, type));
  });
}

function renderAll() {
  fillGrid("liveGrid", liveChannels, "live");
  fillGrid("homeLive", liveChannels, "live", 6);
  fillGrid("movieGrid", movies, "movie");
  fillGrid("seriesGrid", series, "series");

  $("liveCount").textContent = liveChannels.length + " قناة";
  $("movieCount").textContent = movies.length + " فيلم";
  $("seriesCount").textContent = series.length + " مسلسل";

  $("settingsLive").textContent = liveChannels.length;
  $("settingsMovies").textContent = movies.length;
  $("settingsSeries").textContent = series.length;
}

function playContent(title, url) {
  if (!url) {
    alert("رابط المحتوى غير متوفر.");
    return;
  }

  $("playerTitle").textContent = title;
  $("playerMessage").textContent = "جاري تشغيل المحتوى...";
  $("playerModal").hidden = false;

  const video = $("videoPlayer");
  video.pause();
  video.removeAttribute("src");
  video.load();

  video.src = url;
  video.load();

  video.play().catch(() => {
    $("playerMessage").textContent =
      "تعذر التشغيل التلقائي. اضغط زر التشغيل.";
  });
}

async function openSeries(item) {
  $("playerTitle").textContent = item.name || "المسلسل";
  $("playerMessage").textContent = "جاري تحميل الحلقات...";
  $("playerModal").hidden = false;

  const video = $("videoPlayer");
  video.pause();
  video.removeAttribute("src");
  video.load();

  const oldList = document.getElementById("episodeList");
  if (oldList) oldList.remove();

  try {
    const data = await request({
      action: "get_series_info",
      series_id: item.series_id
    });

    const seasons = data?.episodes || {};
    const episodes = Object.values(seasons).flat();

    if (!episodes.length) {
      $("playerMessage").textContent =
        "لا توجد حلقات متاحة لهذا المسلسل.";
      return;
    }

    $("playerMessage").textContent =
      "تم العثور على " + episodes.length +
      " حلقة. اختر الحلقة من القائمة.";

    const list = document.createElement("div");
    list.id = "episodeList";
    list.style.cssText =
      "overflow:auto;padding:15px;max-height:45vh;";

    episodes.forEach((episode, index) => {
      const button = document.createElement("button");

      button.textContent =
        episode.title || "الحلقة " + (index + 1);

      button.style.cssText =
        "display:block;width:100%;padding:13px;margin:6px 0;" +
        "border:1px solid #ffffff22;border-radius:12px;" +
        "background:#191827;color:white;text-align:right;";

      button.addEventListener("click", () => {
        const url = streamUrl(
          "series",
          episode.id,
          episode.container_extension || "mp4"
        );

        $("playerTitle").textContent = button.textContent;
        $("playerMessage").textContent = "جاري تشغيل الحلقة...";

        video.src = url;
        video.load();

        video.play().catch(() => {
          $("playerMessage").textContent =
            "اضغط زر التشغيل لبدء الحلقة.";
        });

        list.remove();
      });

      list.append(button);
    });

    $("playerModal").append(list);

  } catch (error) {
    $("playerMessage").textContent = error.message;
  }
}

function changePage(page) {
  document.querySelectorAll(".page").forEach(element => {
    element.classList.toggle(
      "active",
      element.id === "page-" + page
    );
  });

  document.querySelectorAll(".nav-item").forEach(element => {
    element.classList.toggle(
      "active",
      element.dataset.page === page
    );
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-page]").forEach(button => {
  button.addEventListener("click", () => {
    changePage(button.dataset.page);
  });
});

$("closePlayer").addEventListener("click", () => {
  $("videoPlayer").pause();
  $("videoPlayer").removeAttribute("src");
  $("videoPlayer").load();

  $("playerModal").hidden = true;

  const list = document.getElementById("episodeList");
  if (list) list.remove();
});

$("retryBtn").addEventListener("click", () => {
  setLoading("جاري إعادة الاتصال...");
  loadEverything();
});

function setupSearch(inputId, getSource, containerId, type) {
  $(inputId).addEventListener("input", event => {
    const query = event.target.value.trim().toLowerCase();

    const filtered = getSource().filter(item =>
      String(item.name || "").toLowerCase().includes(query)
    );

    fillGrid(containerId, filtered, type);
  });
}

setupSearch("liveSearch", () => liveChannels, "liveGrid", "live");
setupSearch("movieSearch", () => movies, "movieGrid", "movie");
setupSearch("seriesSearch", () => series, "seriesGrid", "series");

loadEverything();
