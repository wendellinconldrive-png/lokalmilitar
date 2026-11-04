import { api } from "@/lib/api";

const decodeVapidKey = (value) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(window.atob(padded), (character) => character.charCodeAt(0));
};

export const isMobileDevice = () => (
  navigator.userAgentData?.mobile
  || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
);

export const isIosDevice = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);

export const isInstalledApp = () => (
  window.matchMedia?.("(display-mode: standalone)").matches
  || navigator.standalone === true
);

export const enablePushNotifications = async () => {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Este navegador não oferece notificações push");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Permita as notificações do navegador para ativar os avisos");
  }

  const registration = await navigator.serviceWorker.register("/push-service-worker.js");
  await navigator.serviceWorker.ready;
  const { data } = await api.get("/notifications/push/public-key");
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(data.public_key),
    });
  }
  await api.post("/notifications/push/subscribe", subscription.toJSON());
  return subscription;
};
