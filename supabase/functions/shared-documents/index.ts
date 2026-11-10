// Public, read-only access to a shared document folder/file (verify_jwt = false).
// Anyone with the share token can list the shared tree and get short-lived signed URLs
// for files inside it. Nothing outside the shared folder is reachable.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const BUCKET = "student-documents";
const URL_TTL = 600; // seconds
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

type Doc = {
  id: string; user_id: string; name: string; item_type: string; parent_id: string | null;
  storage_path: string | null; mime_type: string | null; file_size: number | null; updated_at: string;
};
const COLS = "id, user_id, name, item_type, parent_id, storage_path, mime_type, file_size, updated_at";
const publicDoc = (d: Doc) => ({
  id: d.id, name: d.name, item_type: d.item_type, mime_type: d.mime_type, file_size: d.file_size, updated_at: d.updated_at,
});

async function loadShare(token: unknown) {
  if (typeof token !== "string" || !/^[a-f0-9]{32}$/.test(token)) return null;
  const { data: share } = await admin.from("document_shares").select("*").eq("token", token).maybeSingle();
  if (!share || share.revoked_at) return null;
  if (share.expires_at && new Date(share.expires_at) <= new Date()) return null;
  const { data: root } = await admin.from("documents").select(COLS).eq("id", share.document_id).maybeSingle();
  if (!root || root.user_id !== share.owner_id) return null;
  return { share, root: root as Doc };
}

/** Load a document and return the chain root..doc, or null if it is not inside the shared root. */
async function pathInside(root: Doc, id: string): Promise<Doc[] | null> {
  if (id === root.id) return [root];
  const chain: Doc[] = [];
  let cur: string | null = id;
  for (let depth = 0; cur && depth < 40; depth++) {
    const { data } = await admin.from("documents").select(COLS).eq("id", cur).maybeSingle();
    if (!data || data.user_id !== root.user_id) return null;
    chain.unshift(data as Doc);
    if (data.parent_id === root.id) return [root, ...chain];
    cur = data.parent_id;
  }
  return null;
}

/** Public URL of the preview card the owner's browser rendered at share time, if it exists. */
async function cardUrl(ownerId: string, token: string) {
  const { data } = await admin.storage.from("profile-banners").list(`${ownerId}/share-cards`, { search: token, limit: 1 });
  const file = data?.find((f) => f.name === `${token}.jpg`);
  if (!file) return null;
  const url = admin.storage.from("profile-banners").getPublicUrl(`${ownerId}/share-cards/${token}.jpg`).data.publicUrl;
  return `${url}?v=${new Date(file.updated_at || file.created_at || Date.now()).getTime()}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const ctx = await loadShare(body.token);
  if (!ctx) return json({ error: "Link chia sẻ không tồn tại, đã hết hạn hoặc đã bị thu hồi." }, 404);
  const { share, root } = ctx;

  // Summary for link previews (Messenger/Zalo cards). Does not count as a view.
  if (body.action === "meta") {
    const { data: owner } = await admin.from("profiles").select("display_name").eq("id", share.owner_id).maybeSingle();
    let files = 0, folders = 0;
    if (root.item_type === "folder") {
      const { data } = await admin.from("documents").select("item_type").eq("parent_id", root.id).eq("user_id", root.user_id);
      for (const d of data || []) d.item_type === "folder" ? folders++ : files++;
    }
    return json({
      owner: owner?.display_name || "Một sinh viên",
      name: root.name,
      item_type: root.item_type,
      mime_type: root.mime_type,
      file_size: root.file_size,
      files, folders,
      allow_download: share.allow_download,
      card_url: await cardUrl(share.owner_id, share.token),
    });
  }

  if (body.action === "list") {
    const folderId = typeof body.folder_id === "string" ? body.folder_id : root.id;
    const path = await pathInside(root, folderId);
    if (!path) return json({ error: "Không tìm thấy thư mục." }, 404);
    const target = path[path.length - 1];
    let items: Doc[] = [];
    if (target.item_type === "folder") {
      const { data } = await admin.from("documents").select(COLS)
        .eq("parent_id", target.id).eq("user_id", root.user_id).order("item_type", { ascending: false }).order("name");
      items = (data || []) as Doc[];
    } else {
      items = [target];
    }
    const { data: owner } = await admin.from("profiles").select("display_name, avatar_url").eq("id", share.owner_id).maybeSingle();
    if (!body.folder_id) {
      await admin.from("document_shares").update({ view_count: (share.view_count || 0) + 1 }).eq("id", share.id);
    }
    return json({
      share: { allow_download: share.allow_download, expires_at: share.expires_at, created_at: share.created_at },
      owner: { display_name: owner?.display_name || "Một sinh viên", avatar_url: owner?.avatar_url || null },
      root: publicDoc(root),
      path: path.map(publicDoc),
      items: items.map(publicDoc),
    });
  }

  if (body.action === "urls") {
    const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string").slice(0, 60) as string[] : [];
    const download = body.download === true;
    if (download && !share.allow_download) return json({ error: "Người chia sẻ không cho phép tải về." }, 403);
    const urls: Record<string, string> = {};
    if (!ids.length) return json({ urls });
    const { data: docs } = await admin.from("documents").select(COLS).in("id", ids).eq("user_id", root.user_id);
    const parentOk = new Map<string, boolean>();
    for (const doc of (docs || []) as Doc[]) {
      if (doc.item_type !== "file" || !doc.storage_path) continue;
      let ok = doc.id === root.id;
      if (!ok && doc.parent_id) {
        if (!parentOk.has(doc.parent_id)) parentOk.set(doc.parent_id, !!(await pathInside(root, doc.parent_id)));
        ok = parentOk.get(doc.parent_id)!;
      }
      if (!ok) continue;
      const { data } = await admin.storage.from(BUCKET)
        .createSignedUrl(doc.storage_path, URL_TTL, download ? { download: doc.name } : undefined);
      if (data?.signedUrl) urls[doc.id] = data.signedUrl;
    }
    return json({ urls });
  }

  return json({ error: "Unknown action" }, 400);
});
