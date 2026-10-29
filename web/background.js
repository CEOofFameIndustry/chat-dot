/* Only this selected Gemini conversation is ever read or modified. */
let port = null;
let ready = false;
let target = "";
let message = "";
let incoming = null;
let active = null;
function validChat(url) {
  try {const u = new URL(url); return (u.origin === "https://gemini.google.com" && /^\/(?:u\/\d+\/)?app\/[a-zA-Z0-9_-]+$/.test(u.pathname)) || (u.origin === "https://chatgpt.com" && /^\/(?:g\/[a-zA-Z0-9_-]+\/)?c\/[a-zA-Z0-9-]+$/.test(u.pathname)) || (u.origin === "https://claude.ai" && /^\/chat\/[a-zA-Z0-9-]+$/.test(u.pathname));}
  catch {return false;}
}
function canonical(url) {const u = new URL(url); return u.origin + u.pathname;}
async function inject(tabId) {
  const file = target.startsWith("https://claude.ai/") ? "claude.js" : target.startsWith("https://chatgpt.com/") ? "chatgpt.js" : "content.js";
  // Reload the packaged adapter when working on an unpacked temporary extension.
  const response = await fetch(browser.runtime.getURL(file), {cache: "no-store"});
  if (!response.ok) throw new Error("Не вдалося прочитати адаптер чату.");
  await browser.tabs.executeScript(tabId, {code: await response.text()});
}

function send(data) {if (port) port.postMessage(data);}
function status(text) {message = text; send({type: "status", message: text});}
async function cancelJob(id) {
  if (incoming?.id === id) incoming = null;
  if (active?.id === id) {
    const job = active;
    active = null;
    try {await browser.tabs.sendMessage(job.tabId, {type: "cancel", id});} catch {}
  }
}
async function startJob(job) {
  const tabs = (await browser.tabs.query({url: ["https://gemini.google.com/*", "https://chatgpt.com/*", "https://claude.ai/*"]}))
    .filter(tab => canonical(tab.url) === target);
  if (tabs.length !== 1) throw new Error("Відкрийте рівно одну вкладку вибраного чату. Перевірте адресу в розширенні.");
  const tab = tabs[0];
  if (active) throw new Error("Попередня відповідь ще обробляється.");
  active = {id: job.id, tabId: tab.id};
  try {
    await inject(tab.id);
    const reply = await browser.tabs.sendMessage(tab.id, {
      type: "solve", id: job.id, image: job.parts.join(""), mime: job.mime, url: target
    });
    if (active?.id !== job.id) return;
    if (reply.error) throw new Error(reply.error);
    send({type: "answer", id: job.id, text: reply.text});
    message = "Отримано відповідь.";
  } finally {
    if (active?.id === job.id) active = null;
  }
}
function connect() {
  if (port) return;
  const current = browser.runtime.connectNative("ua.gemini_dot");
  port = current;
  ready = false;
  message = "Підключення до локальної програми…";
  current.onMessage.addListener(data => {
    if (data.type === "ready") {ready = true; message = "Готово. Відкрийте тест на столі 1 і натисніть ↑."; send({type: "hello", target});}
    else if (data.type === "diagnose") {
      (async () => {
        const tabs = (await browser.tabs.query({url: ["https://gemini.google.com/*", "https://chatgpt.com/*", "https://claude.ai/*"]})).filter(t => canonical(t.url) === target);
        if (tabs.length !== 1) return {error: "Не знайдено рівно одну вкладку вибраного чату.", matches: tabs.length};
        await inject(tabs[0].id);
        return browser.tabs.sendMessage(tabs[0].id, {type: "inspect"});
      })().then(report => send({type: "diagnostic", id: data.id, report}))
        .catch(error => send({type: "diagnostic", id: data.id, report: {error: String(error.message).slice(0, 400)}}));
    }
    else if (data.type === "image-start") incoming = {id: data.id, mime: data.mime, parts: [], length: 0};
    else if (data.type === "image-chunk" && incoming?.id === data.id) {
      incoming.length += data.data.length;
      if (incoming.length > 24000000) {incoming = null; send({type: "error", id: data.id, message: "Знімок надто великий."});}
      else incoming.parts.push(data.data);
    } else if (data.type === "image-end" && incoming?.id === data.id) {
      const job = incoming; incoming = null;
      startJob(job).catch(error => send({type: "error", id: job.id, message: String(error.message).slice(0, 400)}));
    } else if (data.type === "cancel") cancelJob(data.id);
  });
  current.onDisconnect.addListener(() => {
    if (port === current) {port = null; ready = false;}
    message = "Міст від’єднано: " + (current.error?.message || "Firefox закрив локальну програму без опису помилки.");
    incoming = null;
    if (active) cancelJob(active.id);
  });
}
browser.runtime.onMessage.addListener(async (data, sender) => {
  if (data.action === "progress") {
    if (active?.id === data.id && active.tabId === sender.tab?.id) {
      message = String(data.message).slice(0, 400);
      send({type: "progress", id: data.id, message});
    }
    return;
  }
  if (data.action === "connect") {connect(); return {ok: true};}
  if (data.action === "status") {return {connected: ready, target, message};}
  if (data.action === "select") {
    if (!validChat(data.url)) return {error: "Спершу відкрийте потрібну розмову на claude.ai, chatgpt.com або gemini.google.com."};
    if (active) return {error: "Спершу скасуйте поточний запит."};
    target = canonical(data.url);
    await browser.storage.local.set({target});
    connect(); send({type: "hello", target});
    return {ok: true};
  }
  if (data.action === "cancel") {send({type: "cancel-request"}); if (active) await cancelJob(active.id); return {ok: true};}
});
browser.storage.local.get("target").then(saved => {
  if (validChat(saved.target)) target = canonical(saved.target);
  connect();
});
