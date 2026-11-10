// Web Push subscription for deadline reminders.
import { supabase, invokeFunction, readLocal, writeLocal } from './lib.js';

// Public VAPID key (the private key is only in Supabase Vault).
const VAPID_PUBLIC = 'BHXLJrBYpwMoAjxlx9Dryv2FqKVGbOosN5fubAPfzDTJkSIK8W8P9F2KstxviJI6tfN6eHrca_jtxy26zIuyygQ';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** 'unsupported' | 'ios-install' | 'denied' | 'granted' | 'default' */
export function pushStatus() {
  if (isIOS() && !isStandalone()) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  const reg = (await navigator.serviceWorker.getRegistration('/')) || (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  return reg;
}

async function saveSubscription(sub) {
  const j = sub.toJSON();
  const { error } = await supabase.rpc('register_push_subscription', {
    p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

/** Ask permission (must be called from a tap) and register this browser. */
export async function enablePush() {
  const status = pushStatus();
  if (status === 'ios-install') throw new Error('Trên iPhone, hãy bấm Chia sẻ → "Thêm vào MH chính", mở app từ màn hình chính rồi bật thông báo.');
  if (status === 'unsupported') throw new Error('Trình duyệt này chưa hỗ trợ thông báo đẩy. Hãy dùng Chrome, Edge hoặc Safari mới.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Bạn đã chặn thông báo. Hãy cho phép thông báo cho campusstreak.com trong cài đặt trình duyệt.');
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC) }));
  await saveSubscription(sub);
  writeLocal('cs-push', 'on');
  return true;
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
  } finally {
    writeLocal('cs-push', 'off');
  }
}

/** True when this browser has an active subscription. */
export async function isPushOn() {
  if (pushStatus() !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return !!(await reg?.pushManager.getSubscription());
}

/** On app start: keep the server copy in sync (endpoints can rotate, or the user switched account). */
export async function syncPush() {
  try {
    if (readLocal('cs-push') === 'off' || pushStatus() !== 'granted') return;
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await saveSubscription(sub);
  } catch (e) { console.warn('push sync', e); }
}

export async function sendTestPush() {
  const res = await invokeFunction('push-reminders', { action: 'test' });
  if (!res.ok) throw new Error(res.data?.error || 'Không gửi được thông báo thử.');
  return res.data;
}

export const pushPromptDismissed = () => readLocal('cs-push-prompt') === 'later' || readLocal('cs-push') === 'off';
export const dismissPushPrompt = () => writeLocal('cs-push-prompt', 'later');
