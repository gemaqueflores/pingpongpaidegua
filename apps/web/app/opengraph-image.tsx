import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "PingPong Paid'egua";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "56px",
          background:
            "linear-gradient(135deg, rgb(2, 17, 63) 0%, rgb(12, 33, 110) 60%, rgb(29, 52, 138) 100%)",
          color: "white",
        }}
      >
        <div style={{ fontSize: 74, fontWeight: 800, marginBottom: 12 }}>PingPong Paid'egua</div>
        <div style={{ fontSize: 42, fontWeight: 700, color: "rgb(255, 208, 37)" }}>
          Plataforma de Tênis de Mesa
        </div>
        <div style={{ marginTop: 28, fontSize: 30, color: "rgb(206, 224, 255)" }}>
          Eventos • Atletas • Eficiência
        </div>
      </div>
    ),
    size,
  );
}
