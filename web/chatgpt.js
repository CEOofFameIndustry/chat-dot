/* ChatGPT DOM adapter: selected conversation only; no cookies or private APIs. */
(() => {
  const state = window.__chatgptDotState ||= {current: null};
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const label = el => [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent].filter(Boolean).join(' ');
  const buttons = () => [...document.querySelectorAll('button,[role="button"]')].filter(visible);
  const editor = () => [...document.querySelectorAll('#prompt-textarea[contenteditable="true"],textarea#prompt-textarea,[contenteditable="true"][role="textbox"],[contenteditable="true"].tiptap')].find(visible);
  const responses = () => { const turns = [...document.querySelectorAll('[data-talvt-turn-state]')]; return turns.length ? turns : [...document.querySelectorAll('[data-message-author-role="assistant"]')]; };
  const stop = () => document.querySelector('[data-testid="stop-button"]') || buttons().find(b => /^stop\b|зупинити|остановить/i.test(label(b)));
  function responseText(node) {
    const copy = ([...node.querySelectorAll('[data-markdown-text-style="assistant-message"]')].at(-1) || node.querySelector('.markdown') || node).cloneNode(true);
    copy.querySelectorAll('button,script,style,[aria-hidden="true"],.turn-action-controls,[class~="sr-only"],[class~="group/user-message"],[data-content-search-unit-key$=":user"],[data-chatgpt-search-unit-key$=":user"]').forEach(n => n.remove());
    return copy.textContent.trim();
  }
  const changed = () => new Promise(resolve => {
    let timer;
    const done = () => {observer.disconnect(); clearTimeout(timer); resolve();};
    const observer = new MutationObserver(done);
    observer.observe(document.documentElement, {subtree:true, childList:true, attributes:true, characterData:true});
    timer = setTimeout(done, 500);
  });
  function check(job) {
    if (state.current !== job || job.cancelled) throw new Error('Запит скасовано.');
    if (location.origin + location.pathname !== job.url) throw new Error('ChatGPT перейшов в іншу розмову.');
  }
  function phase(job, message) {browser.runtime.sendMessage({action:'progress', id:job.id, message}).catch(() => {});}
  async function until(job, fn, timeout, message) {
    const deadline = Date.now() + timeout;
    while (true) {check(job); const value = fn(); if (value) return value;
      if (Date.now() >= deadline) throw new Error(message); await changed();}
  }
  function fileInput() {return [...document.querySelectorAll('input[type="file"]')].find(n => !n.accept || /image|\.png|\*/i.test(n.accept));}
  async function solve(data) {
    if (state.current) throw new Error('Попередній запит ще виконується.');
    const job = {...data, cancelled:false}; state.current = job;
    try {
      check(job);
      if (stop()) throw new Error('ChatGPT уже генерує відповідь.');
      const inputEditor = editor();
      if (!inputEditor) throw new Error('Не знайдено поле повідомлення ChatGPT.');
      if ((inputEditor.value || inputEditor.innerText || '').trim()) throw new Error('У ChatGPT є чернетка. Надішліть або приберіть її.');
      const turnKey = node => node.closest('[data-turn-key]')?.getAttribute('data-turn-key') || node.getAttribute('data-message-id') || node;
      const baseline = new Set(responses().map(turnKey));
      if (!fileInput()) {
        const add = document.querySelector('#composer-plus-btn') || buttons().find(b => /add photos|add files|додати файли|добавить файлы/i.test(label(b)));
        if (!add) throw new Error('Не знайдено кнопку додавання файлів ChatGPT.');
        add.click();
      }
      const upload = await until(job, fileInput, 15000, 'ChatGPT не показав поле завантаження файлу.');
      const binary = atob(data.image), bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      const filename = 'ChatGPTDot-' + data.id + '.png';
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], filename, {type:data.mime}));
      const form = inputEditor.closest('form') || inputEditor.parentElement.parentElement;
      const oldImages = new Set([...form.querySelectorAll('img')].map(n => n.src));
      upload.files = transfer.files; upload.dispatchEvent(new Event('change', {bubbles:true}));
      phase(job, 'Знімок передано ChatGPT; очікую вкладення.');
      await until(job, () => [...form.querySelectorAll('img')].some(n => !oldImages.has(n.src) && n.complete && n.naturalWidth > 0) ||
        [...form.querySelectorAll('[aria-label],[title]')].some(n => label(n).includes(filename)) || form.textContent.includes(filename),
        30000, 'ChatGPT не підтвердив прикріплення знімка. Запит не надіслано.');
      // Send only the screenshot; the user sets instructions in the chat.
      const send = await until(job, () => {
        const b = document.querySelector('[data-testid="send-button"]') || buttons().find(n => /^(send\b|надіслати|отправить)/i.test(label(n).trim()));
        return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? b : null;
      }, 30000, 'Кнопка надсилання ChatGPT недоступна. Перевірте вкладення або ліміти.');
      check(job); send.click(); phase(job, 'Знімок надіслано. Очікую ChatGPT.');
      const text = await until(job, () => {
        const last = responses().filter(n => !baseline.has(turnKey(n))).at(-1);
        if (!last || stop()) return null;
        const article = last.hasAttribute('data-talvt-turn-state') ? last : (last.closest('article') || last.parentElement);
        const complete = last.getAttribute('data-talvt-turn-state') === 'complete' || article.querySelector('[data-testid="copy-turn-action-button"]') || [...article.querySelectorAll('button')].find(b => /copy|копіювати|скопировать/i.test(label(b)));
        const value = responseText(last);
        return complete && value ? value : null;
      }, 300000, 'ChatGPT не завершив відповідь за 5 хвилин. Перевірте чат.');
      return {text};
    } finally {if (state.current === job) state.current = null;}
  }
  window.__chatgptDotHandler = data => {
    if (data.type === 'inspect') return Promise.resolve({provider:'chatgpt', visibility:document.visibilityState, editor:!!editor(), fileInputs:document.querySelectorAll('input[type="file"]').length, responses:responses().length, lastResponse:responses().length ? responseText(responses().at(-1)).slice(0,500) : '', buttons:buttons().map(label).slice(-30), url:location.origin+location.pathname});
    if (data.type === 'cancel' && state.current?.id === data.id) {state.current.cancelled=true; return Promise.resolve({ok:true});}
    if (data.type === 'solve') return solve(data).catch(e => ({error:String(e.message).slice(0,400)}));
  };
  if (!window.__chatgptDotListener) {
    window.__chatgptDotListener = data => window.__chatgptDotHandler(data);
    browser.runtime.onMessage.addListener(window.__chatgptDotListener);
  }
})();
