// Web Push reminders for deadlines (verify_jwt = false; does its own auth).
//   action "cron": called every 5 minutes by pg_cron with header x-cron-secret.
//       Per task: 24h, 6h, 1h, 15 min before the deadline and at the deadline.
//       Daily digest at 7:00, 13:00 and 19:00 Vietnam time listing pending deadlines.
//   action "test": called by a signed-in user (Authorization: Bearer <jwt>) to send a test notification.
// VAPID keys and the cron secret come from Vault through public.get_push_config() (service role only).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const WINDOW_MS = 10 * 60 * 1000; // cron runs every 5 min; each reminder has two chances
const SLOTS = [
  { key: "24h", ms: 24 * 3600e3, label: "Còn 24 giờ" },
  { key: "6h", ms: 6 * 3600e3, label: "Còn 6 giờ" },
  { key: "1h", ms: 3600e3, label: "Còn 1 giờ" },
  { key: "15m", ms: 15 * 60e3, label: "Còn 15 phút" },
];
const DIGEST_HOURS = [7, 13, 19];

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function vnParts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, minute: +p.minute, hm: `${p.hour}:${p.minute}`, dm: `${p.day}/${p.month}` };
}

function left(ms: number) {
  if (ms <= 0) return "đã đến hạn";
  const h = Math.floor(ms / 3600e3);
  if (h >= 48) return `còn ${Math.floor(h / 24)} ngày`;
  if (h >= 1) return `còn ${h} giờ`;
  return `còn ${Math.max(1, Math.round(ms / 60e3))} phút`;
}

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

async function sendTo(subs: Sub[], payload: Record<string, unknown>) {
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 3600, urgency: "high" },
      );
      sent++;
      await admin.from("push_subscriptions").update({ last_success_at: new Date().toISOString() }).eq("id", s.id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
      else console.error("push failed", code, (e as Error).message);
    }
  }
  return sent;
}

/** Insert the dedup key; true only the first time. */
async function claim(ref: string, userId: string) {
  const { data, error } = await admin.from("push_reminder_log").insert({ ref, user_id: userId }).select("ref");
  if (error) return false; // duplicate key = already sent
  return !!data?.length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await req.json().catch(() => ({}));

  const { data: cfgRows, error: cfgErr } = await admin.rpc("get_push_config");
  const cfg = cfgRows?.[0];
  if (cfgErr || !cfg?.vapid_private) return json({ error: "Push is not configured" }, 500);
  webpush.setVapidDetails(cfg.vapid_subject || "https://www.campusstreak.com", cfg.vapid_public, cfg.vapid_private);

  // --- test notification for the signed-in user ---
  if (body.action === "test") {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: "Unauthorized" }, 401);
    const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", u.user.id);
    const sent = await sendTo((subs || []) as Sub[], {
      title: "Đã bật thông báo 🎉",
      body: "Campus Streak sẽ nhắc deadline lúc 7h, 13h, 19h và trước hạn 24h, 6h, 1h, 15 phút.",
      url: "/deadlines", tag: "test",
    });
    return json({ sent, devices: subs?.length || 0 });
  }

  // --- cron ---
  if (req.headers.get("x-cron-secret") !== cfg.cron_secret) return json({ error: "Unauthorized" }, 401);

  const now = new Date();
  const nowMs = now.getTime();
  const { data: subsAll } = await admin.from("push_subscriptions").select("*");
  const subsByUser = new Map<string, Sub[]>();
  for (const s of (subsAll || []) as Sub[]) {
    if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, []);
    subsByUser.get(s.user_id)!.push(s);
  }
  if (!subsByUser.size) return json({ ok: true, users: 0 });

  const { data: tasks } = await admin.from("deadline_tasks")
    .select("id, user_id, title, deadline_at")
    .eq("is_completed", false)
    .in("user_id", [...subsByUser.keys()])
    .gt("deadline_at", new Date(nowMs - WINDOW_MS).toISOString())
    .order("deadline_at");

  let sent = 0;
  const pendingByUser = new Map<string, { title: string; at: number }[]>();
  for (const t of tasks || []) {
    const at = new Date(t.deadline_at).getTime();
    const subs = subsByUser.get(t.user_id) || [];
    if (at > nowMs) {
      if (!pendingByUser.has(t.user_id)) pendingByUser.set(t.user_id, []);
      pendingByUser.get(t.user_id)!.push({ title: t.title, at });
    }
    const vp = vnParts(new Date(at));
    for (const slot of SLOTS) {
      const fireAt = at - slot.ms;
      if (nowMs >= fireAt && nowMs < fireAt + WINDOW_MS && await claim(`${t.id}:${slot.key}:${t.deadline_at}`, t.user_id)) {
        sent += await sendTo(subs, {
          title: `⏰ ${slot.label}: ${t.title}`,
          body: `Hạn ${vp.hm} ngày ${vp.dm}. Hoàn thành sớm để không bị trễ nhé!`,
          url: "/deadlines", tag: `task-${t.id}`,
        });
      }
    }
    if (nowMs >= at && nowMs < at + WINDOW_MS && await claim(`${t.id}:due:${t.deadline_at}`, t.user_id)) {
      sent += await sendTo(subs, {
        title: `🔥 Đến hạn: ${t.title}`,
        body: "Deadline đã đến. Mở Campus Streak để cập nhật hoặc gia hạn.",
        url: "/deadlines", tag: `task-${t.id}`,
      });
    }
  }

  const vn = vnParts(now);
  if (DIGEST_HOURS.includes(vn.hour) && vn.minute < 10) {
    for (const [userId, list] of pendingByUser) {
      if (!list.length || !(await claim(`digest:${userId}:${vn.date}:${vn.hour}`, userId))) continue;
      const lines = list.slice(0, 3).map((x) => `• ${x.title} (${left(x.at - nowMs)})`).join("\n");
      const more = list.length > 3 ? `\n… và ${list.length - 3} deadline khác` : "";
      const greet = vn.hour === 7 ? "Chào buổi sáng" : vn.hour === 13 ? "Buổi chiều rồi" : "Buổi tối rồi";
      sent += await sendTo(subsByUser.get(userId) || [], {
        title: `${greet}! Bạn còn ${list.length} deadline`,
        body: lines + more,
        url: "/deadlines", tag: `digest-${vn.hour}`,
      });
    }
  }

  // Keep the dedup log small.
  if (vn.hour === 3 && vn.minute < 5) {
    await admin.from("push_reminder_log").delete().lt("sent_at", new Date(nowMs - 30 * 86400e3).toISOString());
  }
  return json({ ok: true, users: subsByUser.size, tasks: tasks?.length || 0, sent });
});
