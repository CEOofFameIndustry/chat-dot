/* Codex DOM adapter: selected conversation only; no cookies or private APIs. */
(() => {
  const state = window.__codexDotState ||= {current: null};
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const label = el => [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent].filter(Boolean).join(' ');
  const buttons = () => [...document.querySelectorAll('button,[role="button"]')].filter(visible);
  const editor = () => [...document.querySelectorAll('#prompt-textarea[contenteditable="true"],textarea#prompt-textarea,[contenteditable="true"][role="textbox"],[contenteditable="true"].tiptap')].find(visible);
  const responses = () => [...document.querySelectorAll('[data-turn-key]')];
  const stop = () => document.querySelector('[data-testid="stop-button"]') || buttons().find(b => /^stop\b|зупинити|остановить/i.test(label(b)));
  function responseText(node) {
    const copy = ([...node.querySelectorAll('[data-markdown-text-style="assistant-message"]')].at(-1) || node.querySelector('.markdown') || document.createElement('div')).cloneNode(true);
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
    if (location.origin + location.pathname !== job.url) throw new Error('Codex перейшов в іншу розмову.');
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
      if (stop()) throw new Error('Codex уже генерує відповідь.');
      const inputEditor = editor();
      if (!inputEditor) throw new Error('Не знайдено поле повідомлення Codex.');
      if ((inputEditor.value || inputEditor.innerText || '').trim()) throw new Error('У Codex є чернетка. Надішліть або приберіть її.');
      const turnKey = node => node.closest('[data-turn-key]')?.getAttribute('data-turn-key') || node.getAttribute('data-message-id') || node;
      const baseline = new Set(responses().map(turnKey));
      const menu = buttons().find(b => b.getAttribute('aria-label') === 'Add files and more' && b.getAttribute('aria-expanded') === 'true');
      if (menu) menu.click();
      if (buttons().some(b => /^Remove .+\.(png|jpe?g|gif)$/i.test(b.getAttribute('aria-label') || ''))) throw new Error('У Codex є вкладення-чернетка. Надішліть або приберіть його перед запуском.');
      const binary = atob(data.image), bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      const filename = 'CodexDot-' + data.id + '.png';
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], filename, {type:data.mime}));
      const form = document.body;
      const oldRemove = new Set(buttons().filter(n => /^Remove /i.test(n.getAttribute('aria-label') || '')).map(n => n.getAttribute('aria-label')));
      const oldImages = new Set([...form.querySelectorAll('img')].map(n => n.src));
      const upload = fileInput();
      if (upload) {upload.files = transfer.files; upload.dispatchEvent(new Event('change', {bubbles:true}));}
      else {inputEditor.focus(); inputEditor.dispatchEvent(new ClipboardEvent('paste', {clipboardData:transfer, bubbles:true, cancelable:true}));}
      phase(job, 'Знімок передано Codex; очікую вкладення.');
      const pastedAt = Date.now(); let nativePasteTried = false;
      await until(job, () => {
        const attached = buttons().some(n => /^Remove /i.test(n.getAttribute('aria-label') || '') && !oldRemove.has(n.getAttribute('aria-label'))) || [...form.querySelectorAll('img')].some(n => !oldImages.has(n.src) && n.complete && n.naturalWidth > 0) ||
        [...form.querySelectorAll('[aria-label],[title]')].some(n => label(n).includes(filename)) || form.textContent.includes(filename);
        if (attached) return true;
        if (!upload && !nativePasteTried && Date.now() - pastedAt > 2000) {nativePasteTried = true; inputEditor.focus(); document.execCommand('paste');}
        return false;
      },
        30000, 'Codex не підтвердив прикріплення знімка. Запит не надіслано.');
      // Send only the screenshot; the user sets instructions in the chat.
      const send = await until(job, () => {
        const b = document.querySelector('[data-testid="send-button"]') || buttons().find(n => /^(send\b|надіслати|отправить)/i.test(label(n).trim()));
        return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? b : null;
      }, 30000, 'Кнопка надсилання Codex недоступна. Перевірте вкладення або ліміти.');
      check(job); send.click(); phase(job, 'Знімок надіслано. Очікую Codex.');
      const text = await until(job, () => {
        const last = responses().filter(n => !baseline.has(turnKey(n))).at(-1);
        if (!last || stop()) return null;
        const article = last;
        const complete = article.querySelector('.turn-action-controls button[aria-label="Copy"], [data-testid="copy-turn-action-button"]');
        const value = responseText(last);
        return complete && value ? value : null;
      }, 300000, 'Codex не завершив відповідь за 5 хвилин. Перевірте чат.');
      return {text};
    } finally {if (state.current === job) state.current = null;}
  }
  window.__codexDotHandler = data => {
    if (data.type === 'inspect') return Promise.resolve({provider:'codex', visibility:document.visibilityState, editor:!!editor(),focused:document.hasFocus(), fileInputs:document.querySelectorAll('input[type="file"]').length, responses:responses().length, lastResponse:responses().length ? responseText(responses().at(-1)).slice(0,500) : '', buttons:buttons().map(label).slice(-30), url:location.origin+location.pathname});
    if (data.type === 'cancel' && state.current?.id === data.id) {state.current.cancelled=true; return Promise.resolve({ok:true});}
    if (data.type === 'solve') return solve(data).catch(e => ({error:String(e.message).slice(0,400)}));
  };
  if (!window.__codexDotListener) {
    window.__codexDotListener = data => window.__codexDotHandler(data);
    browser.runtime.onMessage.addListener(window.__codexDotListener);
  }
})();
