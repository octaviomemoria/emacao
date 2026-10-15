// Service worker: recebe notificações push e abre o app ao tocar nelas.
self.addEventListener("push", (event) => {
  let data = { title: "Radar de Rompimentos", body: "", url: "/alertas" };
  try { data = { ...data, ...event.data.json() }; } catch {}
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icons/icon.svg", badge: "/icons/icon.svg", data: { url: data.url } }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => {
    for (const c of cs) if ("focus" in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
