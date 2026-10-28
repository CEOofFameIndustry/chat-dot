/* Ordinary DOM interaction; no private Gemini APIs, cookies or model changes. */
if (!window.__geminiDotWebBridge) {
  window.__geminiDotWebBridge = true;
  let current = null;
  // DOM mutations wake the wait even when Firefox throttles background timers.
  const changed = () => new Promise(resolve => {
    let timer;
    const done = () => {observer.disconnect(); clearTimeout(timer); resolve();};
    const observer = new MutationObserver(done);
    observer.observe(document.documentElement, {subtree: true, childList: true, attributes: true, characterData: true});
    timer = setTimeout(done, 500);
  });
  function phase(job, text) {
    job.phase = text;
    browser.runtime.sendMessage({action: "progress", id: job.id, message: text}).catch(() => {});
  }
  const visible = node => !!node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden";
  const name = node => [node.getAttribute("aria-label"), node.getAttribute("title"), node.innerText].filter(Boolean).join(" ");
  const buttons = () => [...document.querySelectorAll("button,[role=button]")].filter(visible);
  const responses = () => [...document.querySelectorAll("model-response")];
  const fileInput = () => [...document.querySelectorAll('input[type="file"]')]
    .find(el => !el.accept || /image|\.png|\*/i.test(el.accept));
  async function uploadInput(job) {
    if (fileInput()) return fileInput();
    const opener = buttons().find(b => /upload and tools|add files|додати файли|завантаження та інструменти/i.test(name(b)));
    if (!opener) throw new Error("Не знайдено кнопку Upload and tools у Gemini.");
    opener.click();
    const control = await until(job, () => fileInput() ||
      [...document.querySelectorAll('button,[role="menuitem"],[role="button"]')].find(b => visible(b) &&
        /upload files|upload file|завантажити файли|завантажити файл|загрузить файлы/i.test(name(b))),
      30000, "У меню Gemini не знайдено Upload files. Перевірте меню завантаження.");
    if (control.matches('input[type="file"]')) return control;
    control.click();
    return until(job, fileInput, 30000, "Gemini не створив доступне поле файлу після Upload files.");
  }
  function editors() {
    const nodes = [...document.querySelectorAll('[contenteditable="true"][role="textbox"],rich-textarea [contenteditable="true"]')]
      .filter(node => visible(node) && !node.closest('.ql-clipboard,[aria-hidden="true"]'));
    // Gemini can mark both an editor wrapper and its nested text area editable.
    return nodes.filter(node => !nodes.some(other => other !== node && node.contains(other)));
  }
  function responseText(node) {
    const content = node.querySelector(".markdown-main-panel,.model-response-text,.markdown");
    const copy = (content || node).cloneNode(true);
    // Gemini embeds source chips such as "PNG" in the answer's markdown.
    // Exclude interface controls, but keep all actual answer text for validation.
    copy.querySelectorAll('button,[role="button"],script,style').forEach(el => el.remove());
    return copy.textContent.trim();
  }
  function stopButton() {return buttons().find(b => /stop response|stop generating|зупинити відповідь|зупинити генерац|остановить ответ|остановить генерац/i.test(name(b)));}
  function check(job) {
    if (current !== job || job.cancelled) throw new Error("Запит скасовано.");
    if (location.origin + location.pathname !== job.url) throw new Error("Вкладка Gemini перейшла в іншу розмову.");
  }
  async function until(job, fn, timeout, error) {
    const end = Date.now() + timeout;
    while (true) {
      check(job);
      // A background tab may resume its timer after the nominal deadline.
      // Check the current DOM before declaring that the expected UI is absent.
      const value = fn();
      if (value) return value;
      if (Date.now() >= end) throw new Error(error);
      await changed();
    }
  }
  async function solve(data) {
    if (current) throw new Error("У цій вкладці вже виконується запит.");
    const job = {...data, cancelled: false}; current = job;
    try {
      check(job);
      if (stopButton()) throw new Error("Gemini вже генерує відповідь. Зачекайте її завершення.");
      const candidates = editors();
      if (candidates.length !== 1) throw new Error("Не знайдено однозначне поле введення Gemini. Відкрийте чат і перевірте вхід в акаунт.");
      const editor = candidates[0];
      if (editor.innerText.trim()) throw new Error("У полі Gemini є ваша чернетка. Надішліть або приберіть її перед запуском.");
      const baseline = responses().length;
      if (!baseline) throw new Error("Не розпізнано структуру відповідей Gemini. Потрібно адаптувати розширення до цієї версії сторінки.");
      const binary = atob(data.image), bytes = new Uint8Array(binary.length);
      for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
      const filename = "GeminiDot-" + data.id + ".png";
      const file = new File([bytes], filename, {type: data.mime});
      const transfer = new DataTransfer(); transfer.items.add(file);
      const originalImages = new Set([...document.images].map(img => img.src));
      phase(job, "Відкриваю завантаження знімка у Gemini.");
      const input = await uploadInput(job);
      check(job);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", {bubbles: true}));
      phase(job, "Знімок передано полю файлу; очікую вкладення.");
      await until(job, () => {
        const named = [...document.querySelectorAll('[aria-label],[title]')].some(n => visible(n) && name(n).includes(filename));
        const newImage = [...document.images].some(img => visible(img) && !originalImages.has(img.src) && /^(blob:|data:)/.test(img.src));
        return named || newImage || document.body.innerText.includes(filename);
      }, 20000, "Gemini не підтвердив прикріплення знімка. Запит не надіслано; потрібна перевірка поля завантаження.");
      const send = await until(job, () => buttons().find(b =>
        /^(send|send message|submit|надіслати|надіслати повідомлення|отправить|отправить сообщение)(\s|$)/i.test(name(b).trim()) &&
        !b.disabled && b.getAttribute("aria-disabled") !== "true"),
        20000, "Кнопка надсилання Gemini недоступна. Перевірте завантаження знімка.");
      check(job); send.click();
      phase(job, "Знімок надіслано. Очікую завершену відповідь Gemini.");
      const text = await until(job, () => {
        const turns = responses();
        if (turns.length <= baseline) return null;
        const last = turns[turns.length - 1];
        const value = responseText(last);
        if (stopButton()) return null;
        const footer = [...last.querySelectorAll("button,[role=button]")].some(b => /copy|копіювати|скопировать|good response|bad response/i.test(name(b)));
        if (!footer || !value) return null;
        return value;
      }, 300000, "Gemini не завершив відповідь за 5 хвилин. Перевірте чат, ліміти або перевірку входу.");
      phase(job, "Відповідь прочитано; передаю відповідь локальній програмі.");
      return {text};
    } finally {if (current === job) current = null;}
  }
  browser.runtime.onMessage.addListener(data => {
    if (data.type === "inspect") return Promise.resolve({
      editors: editors().length,
      editorDetails: editors().map(el => ({tag: el.tagName, role: el.getAttribute("role"), label: el.getAttribute("aria-label"), classes: el.className})),
      responses: responses().length,
      visibility: document.visibilityState,
      phase: current?.phase || null,
      lastResponse: responses().length ? {
        text: responseText(responses().at(-1)).slice(0, 500),
        controls: [...responses().at(-1).querySelectorAll('button,[role=button]')].map(name).map(n => n.slice(0, 100))
      } : null,
      fileInputs: [...document.querySelectorAll('input[type="file"]')].map(el => ({accept: el.accept})),
      controls: buttons().map(name).filter(n => /send|upload|attach|stop|надісл|завантаж|дода|зупин/i.test(n)).map(n => n.slice(0, 100)),
      generating: !!stopButton()
    });
    if (data.type === "solve") return solve(data).catch(error => ({error: String(error.message).slice(0, 400)}));
    if (data.type === "cancel") {
      if (current?.id === data.id) {current.cancelled = true; const button = stopButton(); if (button) button.click();}
      return Promise.resolve({ok: true});
    }
  });
}
