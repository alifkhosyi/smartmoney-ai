import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export interface OcrResult {
  total: number;
  merchant: string | null;
  items: { name: string; price: number }[];
  category: string;
  date: string | null;
  confidence: "high" | "medium" | "low";
}

export async function parseReceiptImage(
  imageBase64: string,
  mimeType: string = "image/jpeg"
): Promise<OcrResult> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType as
                | "image/jpeg"
                | "image/png"
                | "image/gif"
                | "image/webp",
              data: imageBase64,
            },
          },
          {
            type: "text",
            text: `Kamu adalah parser struk belanja Indonesia. Analisis gambar struk/nota ini dan ekstrak informasi berikut.

Respond HANYA dengan JSON valid, tanpa penjelasan apapun:
{
  "total": <angka total belanja dalam rupiah, tanpa titik/koma>,
  "merchant": "<nama toko/restoran atau null jika tidak ada>",
  "items": [
    { "name": "<nama item>", "price": <harga dalam rupiah> }
  ],
  "category": "<salah satu: Makanan, Belanja, Transport, Kesehatan, Hiburan, Tagihan, Lainnya>",
  "date": "<tanggal format YYYY-MM-DD atau null jika tidak ada>",
  "confidence": "<high jika struk jelas, medium jika agak buram, low jika sulit dibaca>"
}

Jika gambar bukan struk/nota, kembalikan:
{"error": "Bukan struk belanja"}`,
          },
        ],
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const clean = text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);

  if (parsed.error) throw new Error(parsed.error);
  return parsed as OcrResult;
}
