import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const data = request.nextUrl.searchParams.get("data") ?? "";

  if (!data.trim()) {
    return new NextResponse("Parametro 'data' ausente.", { status: 400 });
  }

  try {
    const svg = await QRCode.toString(data, {
      type: "svg",
      margin: 1,
      width: 720,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    });

    return new NextResponse(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch {
    return new NextResponse("Falha ao gerar QRCode.", { status: 500 });
  }
}
