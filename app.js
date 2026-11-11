"use strict";

const API = window.KOYO_CONFIG.API_BASE.replace(/\/+$/, "");
const KEY = window.KOYO_CONFIG.API_KEY;

let liveChannels = [];
let movies = [];
let series = [];

const $ = id => document.getElementById(id);

async function request(path) {

    const response = await fetch(API + path, {
        headers: {
            "x-app-key": KEY
        }
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "حدث خطأ بالاتصال");
    }

    return data;
}


function showPage(name) {

    document.querySelectorAll(".page").forEach(page => {
        page.classList.remove("active");
    });

    $(name + "Page").classList.add("active");

    document.querySelectorAll(".nav").forEach(button => {
        button.classList.remove("active");
    });

    const buttons = [...document.querySelectorAll(".nav")];

    const index = {
        home: 0,
        live: 1,
        movies: 2,
        series: 3,
        downloads: 4,
        settings: 5
    }[name];

    if (buttons[index]) buttons[index].classList.add("active");

    window.scrollTo({top: 0, behavior: "smooth"});
}


function escapeHTML(value) {

    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}


function poster(item, type) {

    const name = item.name || "بدون اسم";
    const image = item.stream_icon || item.cover || "";

    const id = type === "movie" ? item.stream_id : item.series_id;

    return `
        <div class="content-card"
             data-kind="${type}"
             data-id="${Number(id)}"
             data-title="${escapeHTML(name)}">

            <div class="poster">
                ${image ? `<img src="${escapeHTML(image)}" loading="lazy">` : ""}
            </div>

            <div class="card-info">
                <b>${escapeHTML(name)}</b>
            </div>

        </div>
    `;
}


function channel(item) {

    const name = item.name || "قناة";
    const image = item.stream_icon || "";

    return `
        <div class="channel-card"
             data-kind="live"
             data-id="${Number(item.stream_id)}"
             data-title="${escapeHTML(name)}">

            <div class="channel-logo">
                ${image ? `<img src="${escapeHTML(image)}">` : "TV"}
            </div>

            <div>
                <b>${escapeHTML(name)}</b>
                <small>● متاحة للمشاهدة</small>
            </div>

        </div>
    `;
}


async function loadContent() {

    try {

        const [liveData, movieData, seriesData] = await Promise.all([
            request("/api/live"),
            request("/api/movies"),
            request("/api/series")
        ]);

        liveChannels = (liveData.items || []).filter(item =>
            String(item.name || "")
                .trimStart()
                .toUpperCase()
                .startsWith("AR |")
        );

        movies = movieData.items || [];
        series = seriesData.items || [];

        renderContent();

    } catch (error) {

        console.error(error);

        $("liveGrid").innerHTML =
            `<div class="empty glass">${escapeHTML(error.message)}</div>`;

        $("moviesGrid").innerHTML =
            `<div class="empty glass">${escapeHTML(error.message)}</div>`;

        $("seriesGrid").innerHTML =
            `<div class="empty glass">${escapeHTML(error.message)}</div>`;
    }
}


function renderContent() {

    $("liveGrid").innerHTML =
        liveChannels.length
        ? liveChannels.map(channel).join("")
        : `<div class="empty glass">لا توجد قنوات AR | حالياً</div>`;

    $("moviesGrid").innerHTML =
        movies.map(item => poster(item,"movie")).join("");

    $("seriesGrid").innerHTML =
        series.map(item => poster(item,"series")).join("");

    $("recentGrid").innerHTML =
        movies.slice(0,5).map(item => poster(item,"movie")).join("");
}


function search(inputId, getItems, targetId, renderer) {

    $(inputId).addEventListener("input", event => {

        const value = event.target.value.toLowerCase();

        const results = getItems().filter(item =>
            String(item.name || "").toLowerCase().includes(value)
        );

        $(targetId).innerHTML =
            results.map(renderer).join("") ||
            `<div class="empty glass">لا توجد نتائج</div>`;
    });
}


search("liveSearch",()=>liveChannels,"liveGrid",channel);
search("movieSearch",()=>movies,"moviesGrid",item=>poster(item,"movie"));
search("seriesSearch",()=>series,"seriesGrid",item=>poster(item,"series"));


async function playContent(kind,id,title) {

    $("playerModal").classList.add("open");
    $("playerTitle").textContent = title;
    $("playerMessage").textContent = "جارٍ تجهيز البث...";

    const video = $("videoPlayer");

    try {

        const result = await request(
            `/api/play-url/${kind}/${id}`
        );

        video.src = result.url;

        await video.play();

        $("playerMessage").textContent = "";

    } catch(error) {

        $("playerMessage").textContent =
            "تعذر تشغيل البث: " + error.message;
    }
}


function closePlayer() {

    const video = $("videoPlayer");

    video.pause();
    video.removeAttribute("src");
    video.load();

    $("playerModal").classList.remove("open");
}


document.addEventListener("click", event => {

    const card = event.target.closest("[data-kind][data-id]");

    if (!card) return;

    playContent(
        card.dataset.kind,
        card.dataset.id,
        card.dataset.title
    );
});


$("refreshBtn").addEventListener("click", loadContent);

loadContent();
