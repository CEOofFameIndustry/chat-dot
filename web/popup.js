async function refresh() {
  const state = await browser.runtime.sendMessage({action: "status"});
  document.getElementById("status").textContent =
    (state.connected ? "Локальну програму підключено." : "Немає зв’язку з локальною програмою.") +
    "\nЧат: " + state.target + "\n" + (state.message || "");
}
document.getElementById("connect").onclick = async () => {
  const [tab] = await browser.tabs.query({active: true, currentWindow: true});
  const result = await browser.runtime.sendMessage({action: "select", url: tab?.url});
  if (result.error) document.getElementById("status").textContent = result.error;
  else await refresh();
};
document.getElementById("cancel").onclick = async () => {
  await browser.runtime.sendMessage({action: "cancel"});
  await refresh();
};
browser.runtime.sendMessage({action: "connect"}).then(refresh).catch(() => {
  document.getElementById("status").textContent = "Помилка з’єднання з розширенням.";
});
setInterval(() => refresh().catch(() => {}), 1000);
