self.addEventListener("push", function (event) {
  const data = event.data.json();
  const title = data.title || "VideoChat App";
  const options = {
    body: data.body || "You have a new notification.",
    icon: data.icon || "/static/img/icon-192x192.png", // Replace with your app icon
    badge: data.badge || "/static/img/badge-72x72.png", // Replace with your app badge
    data: {
      url: data.url || "/",
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
