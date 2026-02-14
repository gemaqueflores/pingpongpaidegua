export interface ShareImageOptions {
  title: string;
  subtitle?: string;
  subtitleSecondary?: string;
  lines: string[];
  linesTitle?: string;
  footer?: string;
  metrics?: Array<{ label: string; value: string }>;
  medalTable?: {
    title?: string;
    columns: Array<{ key: string; label: string }>;
    rows: Array<{
      medalType: "ouro" | "prata" | "bronze";
      label: string;
      values: number[];
    }>;
  };
}

export interface GroupSimulationShareOptions {
  eventName: string;
  categoryName: string;
  groups: Array<{
    groupName: string;
    athletes: Array<{
      athleteName: string;
      clubName: string;
    }>;
  }>;
  branding?: string;
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/g).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    const width = context.measureText(next).width;
    if (width <= maxWidth || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawSpotlight(context: CanvasRenderingContext2D, x: number, y: number): void {
  const gradient = context.createRadialGradient(x, y, 8, x, y + 120, 190);
  gradient.addColorStop(0, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.25, "rgba(133,201,255,0.7)");
  gradient.addColorStop(1, "rgba(0,53,128,0)");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y + 120, 190, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#f6fcff";
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      context.beginPath();
      context.arc(x - 22 + col * 14, y - 8 + row * 14, 5.5, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function drawTablePerspective(context: CanvasRenderingContext2D, width: number, topY: number): void {
  const left = 110;
  const right = width - 110;
  const nearY = topY + 240;
  const farY = topY + 132;

  context.fillStyle = "#1f6be4";
  context.beginPath();
  context.moveTo(left - 90, nearY);
  context.lineTo(right + 90, nearY);
  context.lineTo(right - 40, farY);
  context.lineTo(left + 40, farY);
  context.closePath();
  context.fill();

  context.strokeStyle = "#c6deff";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(left - 70, nearY - 8);
  context.lineTo(right + 70, nearY - 8);
  context.lineTo(right - 30, farY + 6);
  context.lineTo(left + 30, farY + 6);
  context.closePath();
  context.stroke();

  context.strokeStyle = "rgba(212, 230, 255, 0.8)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(width / 2, nearY - 5);
  context.lineTo(width / 2, farY + 7);
  context.stroke();

  const netY = farY + 2;
  context.fillStyle = "rgba(240,246,255,0.9)";
  drawRoundedRect(context, left + 30, netY - 6, right - left - 60, 12, 4);
  context.fill();
}

function drawBall(context: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  const gradient = context.createRadialGradient(x - radius * 0.4, y - radius * 0.45, 4, x, y, radius);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.7, "#edf5ff");
  gradient.addColorStop(1, "#dce7f5");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(255,255,255,0.35)";
  context.beginPath();
  context.arc(x - radius * 0.3, y - radius * 0.25, radius * 0.35, 0, Math.PI * 2);
  context.fill();
}

function fitTextWithEllipsis(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
): string {
  if (context.measureText(value).width <= maxWidth) {
    return value;
  }

  let trimmed = value.trim();
  while (trimmed.length > 0 && context.measureText(`${trimmed}...`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }

  return trimmed ? `${trimmed}...` : "...";
}

function toReducedNameForShare(name: string): string {
  const tokens = String(name ?? "")
    .trim()
    .split(/\s+/g)
    .filter(Boolean);
  if (tokens.length <= 1) {
    return tokens[0] ?? "";
  }
  return `${tokens[0]} ${tokens[tokens.length - 1]}`;
}

function drawMedalIcon(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  type: "bronze" | "prata" | "ouro",
): void {
  const palette = {
    bronze: { fill: "#be7b4c", stroke: "#8d5a34", label: "B" },
    prata: { fill: "#c4ced8", stroke: "#8ea0b3", label: "P" },
    ouro: { fill: "#f7bc42", stroke: "#c98e1f", label: "O" },
  }[type];

  context.fillStyle = "#4176d3";
  context.beginPath();
  context.moveTo(x - 12, y - 16);
  context.lineTo(x - 2, y - 4);
  context.lineTo(x - 16, y - 4);
  context.closePath();
  context.fill();

  context.beginPath();
  context.moveTo(x + 12, y - 16);
  context.lineTo(x + 2, y - 4);
  context.lineTo(x + 16, y - 4);
  context.closePath();
  context.fill();

  context.fillStyle = palette.fill;
  context.strokeStyle = palette.stroke;
  context.lineWidth = 2;
  context.beginPath();
  context.arc(x, y + 5, 13, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  context.fillStyle = "#1f2937";
  context.font = "bold 12px 'IBM Plex Sans', sans-serif";
  context.fillText(palette.label, x - 4, y + 10);
}

export async function createShareImageBlob(options: ShareImageOptions): Promise<Blob> {
  const width = 1080;
  const height = 1350;
  const padding = 70;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas indisponível para gerar imagem.");
  }

  const bg = context.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#041631");
  bg.addColorStop(0.45, "#062357");
  bg.addColorStop(1, "#020b20");
  context.fillStyle = bg;
  context.fillRect(0, 0, width, height);

  drawSpotlight(context, 160, 80);
  drawSpotlight(context, width - 160, 80);
  drawTablePerspective(context, width, 270);
  drawBall(context, width - 230, 520, 52);

  const overlayGradient = context.createLinearGradient(0, 0, 0, height);
  overlayGradient.addColorStop(0, "rgba(3,18,46,0.68)");
  overlayGradient.addColorStop(0.6, "rgba(3,15,39,0.75)");
  overlayGradient.addColorStop(1, "rgba(2,10,26,0.88)");
  context.fillStyle = overlayGradient;
  context.fillRect(0, 0, width, height);

  let y = 140;
  context.font = "italic 700 74px 'IBM Plex Sans', sans-serif";
  context.fillStyle = "#eef5ff";
  const titleLines = wrapText(context, options.title.toUpperCase(), width - padding * 2);
  for (const line of titleLines.slice(0, 2)) {
    context.fillText(line, padding, y);
    y += 82;
  }

  if (options.subtitle) {
    context.font = "italic 700 44px 'IBM Plex Sans', sans-serif";
    context.fillStyle = "#ffd43b";
    const subLines = wrapText(context, options.subtitle.toUpperCase(), width - padding * 2);
    for (const line of subLines.slice(0, 2)) {
      context.fillText(line, padding, y);
      y += 50;
    }
    y += 4;
  }

  if (options.subtitleSecondary) {
    context.font = "italic 700 42px 'IBM Plex Sans', sans-serif";
    context.fillStyle = "#e8f2ff";
    const secondaryLines = wrapText(context, options.subtitleSecondary.toUpperCase(), width - padding * 2);
    for (const line of secondaryLines.slice(0, 2)) {
      context.fillText(line, padding, y);
      y += 48;
    }
    y += 10;
  }

  const blockLeft = padding;
  const blockWidth = width - padding * 2;

  if (options.metrics && options.metrics.length > 0) {
    const metricLines: string[] = [];
    context.font = "700 35px 'IBM Plex Sans', sans-serif";
    for (const metric of options.metrics) {
      metricLines.push(...wrapText(context, `${metric.label}: ${metric.value}`, blockWidth - 40));
    }

    const metricHeight = Math.max(110, metricLines.length * 44 + 34);
    drawRoundedRect(context, blockLeft, y, blockWidth, metricHeight, 16);
    context.fillStyle = "rgba(2, 16, 44, 0.72)";
    context.fill();
    context.strokeStyle = "rgba(89, 143, 255, 0.65)";
    context.lineWidth = 2;
    context.stroke();

    context.fillStyle = "#f4f8ff";
    context.font = "700 35px 'IBM Plex Sans', sans-serif";
    let metricY = y + 45;
    for (const line of metricLines) {
      context.fillText(line, blockLeft + 18, metricY);
      metricY += 43;
    }
    y = metricY + 26;
  }

  if (options.medalTable && options.medalTable.columns.length > 0) {
    const laneLeft = blockLeft;
    const laneWidth = blockWidth;
    const laneHeight = 120;
    const medalCx = laneLeft + 34;
    const labelX = laneLeft + 80;
    const laneStartY = y;
    const blockGap = 18;
    const scoreBlockWidth = 86;
    const scoreBlockHeight = 64;

    for (let rowIndex = 0; rowIndex < options.medalTable.rows.length; rowIndex += 1) {
      const row = options.medalTable.rows[rowIndex];
      const laneY = laneStartY + rowIndex * laneHeight;
      const rowTint =
        row.medalType === "ouro"
          ? "rgba(255,212,59,0.28)"
          : row.medalType === "prata"
            ? "rgba(228,236,255,0.25)"
            : "rgba(255,168,96,0.24)";

      // Linha principal com brilho, estilo ranking.
      context.strokeStyle = "rgba(187, 212, 255, 0.28)";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(laneLeft, laneY + laneHeight - 10);
      context.lineTo(laneLeft + laneWidth, laneY + laneHeight - 10);
      context.stroke();

      const glow = context.createLinearGradient(laneLeft + 220, laneY + laneHeight - 14, laneLeft + 420, laneY + laneHeight - 14);
      glow.addColorStop(0, "rgba(255,255,255,0)");
      glow.addColorStop(0.45, rowTint);
      glow.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = glow;
      context.fillRect(laneLeft + 210, laneY + laneHeight - 18, 240, 8);

      drawMedalIcon(context, medalCx, laneY + 42, row.medalType);
      context.fillStyle =
        row.medalType === "ouro" ? "#ffd43b" : row.medalType === "prata" ? "#f4f8ff" : "#ffb86a";
      context.font = "italic 700 54px 'IBM Plex Sans', sans-serif";
      context.fillText(row.label.toUpperCase(), labelX, laneY + 62);

      // Blocos de placar por tipo de evento.
      let scoreX = laneLeft + 430;
      for (let index = 0; index < options.medalTable.columns.length; index += 1) {
        const column = options.medalTable.columns[index];
        const value = row.values[index] ?? 0;

        context.fillStyle = "rgba(224, 236, 255, 0.88)";
        context.font = "700 16px 'IBM Plex Sans', sans-serif";
        const columnLabel = column.label.toUpperCase();
        context.fillText(columnLabel, scoreX, laneY + 16);

        drawRoundedRect(context, scoreX, laneY + 24, scoreBlockWidth, scoreBlockHeight, 6);
        context.fillStyle = "rgba(3, 12, 31, 0.95)";
        context.fill();
        context.strokeStyle =
          row.medalType === "ouro"
            ? "rgba(255,212,59,0.65)"
            : row.medalType === "prata"
              ? "rgba(238,246,255,0.62)"
              : "rgba(255,168,96,0.62)";
        context.lineWidth = 1.3;
        context.stroke();

        context.fillStyle =
          row.medalType === "ouro" ? "#ffd43b" : row.medalType === "prata" ? "#f4f8ff" : "#ffb86a";
        context.font = "700 52px 'IBM Plex Sans', sans-serif";
        const displayValue = String(value).padStart(2, "0");
        context.fillText(displayValue, scoreX + 12, laneY + 74);

        scoreX += scoreBlockWidth + blockGap;
      }
    }

    y += options.medalTable.rows.length * laneHeight + 14;
  }

  if (options.lines.length > 0) {
    if (options.linesTitle) {
      context.fillStyle = "#ffd43b";
      context.font = "italic 700 44px 'IBM Plex Sans', sans-serif";
      context.fillText(options.linesTitle.toUpperCase(), blockLeft, y);
      y += 8;
    }

    context.fillStyle = "#eef5ff";
    context.font = "700 34px 'IBM Plex Sans', sans-serif";
    for (const raw of options.lines) {
      const safe = raw.trim();
      if (!safe) {
        y += 12;
        continue;
      }
      const wrapped = wrapText(context, safe, blockWidth);
      for (const line of wrapped) {
        y += 36;
        context.fillText(line, blockLeft, y);
      }
    }
  }

  if (options.footer) {
    context.font = "italic 700 30px 'IBM Plex Sans', sans-serif";
    context.fillStyle = "#ffd43b";
    context.fillText(options.footer, padding, height - 54);
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((value) => resolve(value), "image/png"),
  );
  if (!blob) {
    throw new Error("Falha ao gerar imagem de compartilhamento.");
  }
  return blob;
}

export async function createGroupSimulationShareImageBlob(
  options: GroupSimulationShareOptions,
): Promise<Blob> {
  const width = 1080;
  const paddingX = 52;
  const topPadding = 54;
  const groupsPerRow = 2;
  const groupGap = 22;
  const groupCardWidth = (width - paddingX * 2 - groupGap) / groupsPerRow;
  const groupHeaderHeight = 52;
  const groupRowHeight = 82;
  const groupCardBaseHeight = 96;
  const footerSpace = 120;
  const warningHeight = 54;

  const cardHeights = options.groups.map((group) => groupCardBaseHeight + groupHeaderHeight + group.athletes.length * groupRowHeight);
  const rowCount = Math.ceil(options.groups.length / groupsPerRow);
  let groupsTotalHeight = 0;
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const leftHeight = cardHeights[rowIndex * groupsPerRow] ?? 0;
    const rightHeight = cardHeights[rowIndex * groupsPerRow + 1] ?? 0;
    groupsTotalHeight += Math.max(leftHeight, rightHeight);
    if (rowIndex < rowCount - 1) {
      groupsTotalHeight += groupGap;
    }
  }

  const headerHeight = 300;
  const contentHeight = headerHeight + groupsTotalHeight + warningHeight + footerSpace;
  const height = Math.max(1350, Math.ceil(contentHeight));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas indisponível para gerar imagem.");
  }

  const bg = context.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#050f2c");
  bg.addColorStop(0.45, "#081e4f");
  bg.addColorStop(1, "#030817");
  context.fillStyle = bg;
  context.fillRect(0, 0, width, height);

  drawSpotlight(context, 150, 74);
  drawSpotlight(context, width - 150, 74);

  for (let i = 0; i < 110; i += 1) {
    const x = (Math.sin(i * 91.7) * 0.5 + 0.5) * width;
    const y = (Math.cos(i * 53.1) * 0.5 + 0.5) * (height - 120);
    const alpha = 0.08 + (i % 7) * 0.01;
    context.fillStyle = `rgba(198,224,255,${alpha.toFixed(2)})`;
    context.beginPath();
    context.arc(x, y, 1.3, 0, Math.PI * 2);
    context.fill();
  }

  const drawCenteredLine = (
    text: string,
    yPos: number,
    maxWidth: number,
    style: { font: string; color: string },
  ): number => {
    context.font = style.font;
    context.fillStyle = style.color;
    const lines = wrapText(context, text, maxWidth);
    let cursorY = yPos;
    for (const line of lines.slice(0, 2)) {
      const lineWidth = context.measureText(line).width;
      context.fillText(line, (width - lineWidth) / 2, cursorY);
      cursorY += 62;
    }
    return cursorY;
  };

  let y = topPadding;

  y = drawCenteredLine(options.eventName.toUpperCase(), y, width - paddingX * 2, {
    font: "italic 800 56px 'IBM Plex Sans', sans-serif",
    color: "#ffd43b",
  });

  context.font = "italic 700 50px 'IBM Plex Sans', sans-serif";
  context.fillStyle = "#eaf3ff";
  const subtitle = "TÊNIS DE MESA BRASIL";
  context.fillText(subtitle, (width - context.measureText(subtitle).width) / 2, y);
  y += 28;

  const glowLine = context.createLinearGradient(paddingX, y, width - paddingX, y);
  glowLine.addColorStop(0, "rgba(255,212,59,0)");
  glowLine.addColorStop(0.5, "rgba(255,212,59,1)");
  glowLine.addColorStop(1, "rgba(255,212,59,0)");
  context.fillStyle = glowLine;
  context.fillRect(paddingX, y, width - paddingX * 2, 4);
  y += 56;

  drawRoundedRect(context, paddingX, y - 44, width - paddingX * 2, 74, 18);
  context.fillStyle = "rgba(9, 33, 86, 0.7)";
  context.fill();
  context.strokeStyle = "rgba(122, 175, 255, 0.8)";
  context.lineWidth = 1.5;
  context.stroke();
  context.font = "italic 700 54px 'IBM Plex Sans', sans-serif";
  context.fillStyle = "#f6fbff";
  const categoryText = fitTextWithEllipsis(context, options.categoryName.toUpperCase(), width - paddingX * 2 - 48);
  context.fillText(categoryText, (width - context.measureText(categoryText).width) / 2, y + 10);
  y += 72;

  const groupsStartY = y;
  let currentY = groupsStartY;
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const first = options.groups[rowIndex * groupsPerRow];
    const second = options.groups[rowIndex * groupsPerRow + 1];
    const rowGroups = [first, second].filter((value): value is NonNullable<typeof value> => Boolean(value));
    const rowHeight = Math.max(...rowGroups.map((group) => groupCardBaseHeight + groupHeaderHeight + group.athletes.length * groupRowHeight));

    for (let colIndex = 0; colIndex < rowGroups.length; colIndex += 1) {
      const group = rowGroups[colIndex];
      const cardX = paddingX + colIndex * (groupCardWidth + groupGap);
      const cardY = currentY;
      const cardHeight = groupCardBaseHeight + groupHeaderHeight + group.athletes.length * groupRowHeight;

      drawRoundedRect(context, cardX, cardY, groupCardWidth, cardHeight, 16);
      context.fillStyle = "rgba(4, 20, 55, 0.74)";
      context.fill();
      context.strokeStyle = "rgba(118, 176, 255, 0.9)";
      context.lineWidth = 1.5;
      context.stroke();

      context.font = "italic 700 44px 'IBM Plex Sans', sans-serif";
      context.fillStyle = "#cbe3ff";
      context.fillText(group.groupName.toUpperCase(), cardX + 22, cardY + 45);

      context.font = "700 34px 'IBM Plex Sans', sans-serif";
      context.fillStyle = "#ffd57a";
      context.fillText("#", cardX + 18, cardY + 95);
      context.fillText("ATLETA", cardX + 70, cardY + 95);

      const lineGradient = context.createLinearGradient(cardX + 16, cardY + 110, cardX + groupCardWidth - 16, cardY + 110);
      lineGradient.addColorStop(0, "rgba(255,212,59,0)");
      lineGradient.addColorStop(0.5, "rgba(255,212,59,0.95)");
      lineGradient.addColorStop(1, "rgba(255,212,59,0)");
      context.fillStyle = lineGradient;
      context.fillRect(cardX + 16, cardY + 108, groupCardWidth - 32, 2);

      let athleteY = cardY + 164;
      for (let idx = 0; idx < group.athletes.length; idx += 1) {
        const athlete = group.athletes[idx];
        context.font = "700 50px 'IBM Plex Sans', sans-serif";
        context.fillStyle = "#ffd57a";
        context.fillText(String(idx + 1), cardX + 18, athleteY);

        context.font = "700 34px 'IBM Plex Sans', sans-serif";
        context.fillStyle = "#f2f7ff";
        const reducedAthleteName = toReducedNameForShare(athlete.athleteName);
        const athleteName = fitTextWithEllipsis(context, reducedAthleteName.toUpperCase(), groupCardWidth - 110);
        context.fillText(athleteName, cardX + 70, athleteY - 10);

        context.font = "600 23px 'IBM Plex Sans', sans-serif";
        context.fillStyle = "#d6e8ff";
        const clubName = fitTextWithEllipsis(context, String(athlete.clubName ?? "").toUpperCase(), groupCardWidth - 110);
        context.fillText(clubName, cardX + 70, athleteY + 30);

        athleteY += groupRowHeight;
        if (idx < group.athletes.length - 1) {
          context.strokeStyle = "rgba(132, 170, 240, 0.35)";
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(cardX + 18, athleteY - 26);
          context.lineTo(cardX + groupCardWidth - 18, athleteY - 26);
          context.stroke();
        }
      }
    }

    currentY += rowHeight + groupGap;
  }

  const warningY = currentY + 18;
  drawRoundedRect(context, paddingX, warningY, width - paddingX * 2, 46, 12);
  context.fillStyle = "rgba(255, 196, 77, 0.18)";
  context.fill();
  context.strokeStyle = "rgba(255, 212, 59, 0.7)";
  context.lineWidth = 1.2;
  context.stroke();
  context.font = "700 24px 'IBM Plex Sans', sans-serif";
  context.fillStyle = "#ffe28f";
  context.fillText("Aviso: apenas simulação de grupo, não é o grupo oficial!", paddingX + 18, warningY + 31);

  context.font = "italic 700 30px 'IBM Plex Sans', sans-serif";
  context.fillStyle = "#ffd43b";
  context.fillText(`Fonte: ${options.branding ?? "PingPong Paid'egua"}`, paddingX, height - 44);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((value) => resolve(value), "image/png"),
  );
  if (!blob) {
    throw new Error("Falha ao gerar imagem de compartilhamento.");
  }
  return blob;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}



