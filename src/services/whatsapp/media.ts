const WA_API_URL = process.env.WHATSAPP_API_URL!;
const WA_TOKEN = process.env.WHATSAPP_API_TOKEN!;

export interface WAMediaResult {
  base64: string;
  mimeType: string;
}

export async function downloadWAMedia(mediaId: string): Promise<WAMediaResult> {
  const metaRes = await fetch(`${WA_API_URL}/${mediaId}`, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` },
  });

  if (!metaRes.ok) {
    throw new Error(`Gagal ambil metadata media: ${metaRes.status}`);
  }

  const meta = await metaRes.json();
  if (!meta.url) throw new Error("URL media tidak ditemukan dari WA API");

  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` },
  });

  if (!fileRes.ok) {
    throw new Error(`Gagal download media: ${fileRes.status}`);
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = meta.mime_type || "image/jpeg";

  return { base64, mimeType };
}
