self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch (error) {
    payload = { title: "LOKAL MILITAR", body: event.data?.text() || "Você tem um novo aviso." };
  }
  event.waitUntil(self.registration.showNotification(payload.title || "LOKAL MILITAR", {
    body: payload.body || "Você tem um novo aviso.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: payload.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
    const appWindow = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (appWindow) {
      await appWindow.focus();
      if ("navigate" in appWindow) await appWindow.navigate(target.href);
      return;
    }
    await clients.openWindow(target.href);
  }));
});
