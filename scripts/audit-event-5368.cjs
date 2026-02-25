const { PrismaReadService, PrismaService } = require("../apps/api/dist/common/prisma.service.js");
const { UserService } = require("../apps/api/dist/user/user.service.js");

const OFFICIAL_RAW = `MASTER 30FEM 4 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 6 confrontos
MASTER 30MAS 14 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 25 confrontos
MASTER 35MAS 8 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 15 confrontos
MASTER 40MAS 9 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 14 confrontos
MASTER 45MAS 8 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 15 confrontos
MASTER 50MAS 8 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 15 confrontos
MASTER 55MAS 5 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 10 confrontos
MASTER 60MAS 7 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 10 confrontos
MASTER 65MAS 3 Inscrito(s) e 0 Pré-inscrito(s)/ 3 medalhistas / 3 confrontos
SUB-07 MAS 3 Inscrito(s) e 0 Pré-inscrito(s)/ 3 medalhistas / 3 confrontos
SUB-07 FEM 3 Inscrito(s) e 0 Pré-inscrito(s)/ 3 medalhistas / 3 confrontos
SUB-17 MAS 7 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 10 confrontos
SUB-17 FEM 4 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 6 confrontos
ABSOLUTO G (MAS) 30 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 49 confrontos
SUB-09 FEM 4 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 6 confrontos
SUB-11 FEM 5 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 10 confrontos
SUB-13 FEM 7 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 10 confrontos
SUB-15 FEM 7 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 10 confrontos
SUB-21 FEM 3 Inscrito(s) e 0 Pré-inscrito(s)/ 3 medalhistas / 3 confrontos
ABSOLUTO A (FEM) 6 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 7 confrontos
ABSOLUTO C (FEM) 4 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 6 confrontos
ABSOLUTO D (FEM) 4 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 6 confrontos
ADULTO (FEM) 7 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 10 confrontos
SUB-09 MAS 3 Inscrito(s) e 0 Pré-inscrito(s)/ 3 medalhistas / 3 confrontos
SUB-11 MAS 7 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 10 confrontos
SUB-13 MAS 15 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 24 confrontos
SUB-15 MAS 13 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 22 confrontos
SUB-19 MAS 8 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 15 confrontos
SUB-21 MAS 7 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 10 confrontos
ABSOLUTO B (MAS) 6 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 7 confrontos
ABSOLUTO C (MAS) 10 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 16 confrontos
ABSOLUTO D (MAS) 15 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 24 confrontos
ABSOLUTO E (MAS) 23 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 39 confrontos
ABSOLUTO F (MAS) 21 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 35 confrontos
ADULTO (MAS) 10 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 16 confrontos
RCM 18 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 30 confrontos
RFM 5 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 10 confrontos
RGM 8 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 15 confrontos
RHM 6 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 7 confrontos
RIM 16 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 27 confrontos
RJM 11 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 18 confrontos
RLM 14 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 25 confrontos
RMM 9 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 14 confrontos
RNM 12 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 20 confrontos
ROM 45 Inscrito(s) e 1 Pré-inscrito(s)/ 4 medalhistas / 74 confrontos
RBF 6 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 7 confrontos
RDF 3 Inscrito(s) e 0 Pré-inscrito(s)/ 3 medalhistas / 3 confrontos
RFF 5 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 10 confrontos
RGF 5 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 10 confrontos
RJF 7 Inscrito(s) e 0 Pré-inscrito(s)/ 4 medalhistas / 10 confrontos`;

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function parseOfficial() {
  const rows = [];
  for (const rawLine of OFFICIAL_RAW.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^(.*?)\s+(\d+)\s+Inscrito\(s\)\s+e\s+(\d+)\s+Pré-inscrito\(s\)\/\s*(\d+)\s+medalhistas\s*\/\s*(\d+)\s+confrontos$/i);
    if (!m) throw new Error(`Linha oficial invalida: ${line}`);
    rows.push({
      name: m[1].trim(),
      inscritos: Number(m[2]),
      pre: Number(m[3]),
      medalhistas: Number(m[4]),
      confrontos: Number(m[5]),
    });
  }
  return rows;
}

async function main() {
  const cbtmEventId = Number(process.argv[2] || 5368);
  const official = parseOfficial();
  const officialByName = new Map(official.map((r) => [norm(r.name), r]));

  const prismaRead = new PrismaReadService();
  const prismaWrite = new PrismaService();
  await prismaRead.$connect();
  await prismaWrite.$connect();

  try {
    const event = await prismaRead.event.findUnique({ where: { cbtmEventId }, select: { id: true, nome: true, cbtmEventId: true } });
    if (!event) throw new Error(`Evento cbtmEventId=${cbtmEventId} nao encontrado.`);

    const service = new UserService(prismaRead, prismaWrite);
    const summary = await service.getEventSummary(event.id);
    const medalists = await service.listEventCategoryMedalists(event.id);

    const categoryDiffs = [];
    const seen = new Set();

    for (const cat of medalists.categories) {
      const key = norm(String(cat.categoryName || "").replace(/\s+-X$/, ""));
      const ref = officialByName.get(key);
      if (!ref) {
        categoryDiffs.push(`EXTRA no sistema: '${cat.categoryName}'`);
        continue;
      }
      seen.add(key);

      const dbInscritos = Number(cat.officialRegisteredCount ?? 0);
      const dbPre = Number(cat.officialPreRegisteredCount ?? 0);
      const dbInscritosDedup = Number(cat.athleteCount ?? 0);
      const dbConfrontos = Number(cat.publishedMatchesCount ?? 0);
      const dbMedalhistas = Number((cat.medalists || []).length);

      const mismatches = [];
      if (dbInscritos !== ref.inscritos) mismatches.push(`inscritos esperado=${ref.inscritos} atual=${dbInscritos}`);
      if (dbPre !== ref.pre) mismatches.push(`pre esperado=${ref.pre} atual=${dbPre}`);
      if (dbInscritosDedup !== ref.inscritos) mismatches.push(`inscritos_dedup esperado=${ref.inscritos} atual=${dbInscritosDedup}`);
      if (dbConfrontos !== ref.confrontos) mismatches.push(`confrontos esperado=${ref.confrontos} atual=${dbConfrontos}`);
      if (dbMedalhistas !== ref.medalhistas) mismatches.push(`medalhistas esperado=${ref.medalhistas} atual=${dbMedalhistas}`);
      if (mismatches.length > 0) categoryDiffs.push(`${cat.categoryName}: ${mismatches.join(" | ")}`);
    }

    for (const ref of official) {
      const key = norm(ref.name);
      if (!seen.has(key)) categoryDiffs.push(`AUSENTE no sistema: '${ref.name}'`);
    }

    const totalOfficialInscricoes = official.reduce((s, r) => s + r.inscritos + r.pre, 0);
    const totalOfficialConfrontos = official.reduce((s, r) => s + r.confrontos, 0);
    const totalOfficialMedalhistas = official.reduce((s, r) => s + r.medalhistas, 0);

    const totalDbInscricoes = medalists.categories.reduce((s, c) => s + Number(c.officialRegisteredCount ?? 0) + Number(c.officialPreRegisteredCount ?? 0), 0);
    const totalDbInscritosDedup = medalists.categories.reduce((s, c) => s + Number(c.athleteCount ?? 0), 0);
    const totalDbConfrontos = Number(summary.totalPartidas ?? 0);
    const totalDbMedalhistas = medalists.categories.reduce((s, c) => s + (c.medalists || []).length, 0);

    console.log(`Evento: ${event.nome} (cbtm=${event.cbtmEventId}, id=${event.id})`);
    console.log(`Categorias oficial=${official.length} sistema=${medalists.categories.length}`);
    console.log(`Inscricoes total oficial=${totalOfficialInscricoes} sistema=${totalDbInscricoes}`);
    console.log(`Inscritos dedup total oficial=${official.reduce((s, r) => s + r.inscritos, 0)} sistema=${totalDbInscritosDedup}`);
    console.log(`Confrontos total oficial=${totalOfficialConfrontos} sistema=${totalDbConfrontos}`);
    console.log(`Medalhistas total oficial=${totalOfficialMedalhistas} sistema=${totalDbMedalhistas}`);
    console.log(`Resumo API: totalInscritos=${summary.totalInscritos} inscricoesTotaisOficiais=${summary.inscricoesTotaisOficiais} totalPartidas=${summary.totalPartidas} totalCategorias=${summary.totalCategorias}`);

    if (categoryDiffs.length === 0 && totalDbConfrontos === 779 && totalDbInscricoes === 503) {
      console.log("AUDITORIA: OK (sem divergencias por categoria)");
    } else {
      console.log(`AUDITORIA: DIVERGENCIAS (${categoryDiffs.length})`);
      for (const d of categoryDiffs.slice(0, 250)) console.log(`- ${d}`);
    }
  } finally {
    await prismaRead.$disconnect();
    await prismaWrite.$disconnect();
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
