import { spawnSync } from "node:child_process";

type Args = {
  eventId: number;
  localApiBase: string;
  prodApiBase: string;
  vercelBase: string;
  localWebBase: string;
  vmWebUrl: string;
  vmSshTarget: string | null;
  vmSshPort: number;
  vmSshKey: string | null;
  vmRepoPath: string;
  skipVmWeb: boolean;
  vmSshNoHostKeyCheck: boolean;
  strict: boolean;
  skipLocalApi: boolean;
  skipLocalWeb: boolean;
  skipVm: boolean;
};

type EventSnapshot = {
  id: number;
  nome: string;
  cbtmEventId: number | null;
  totalCategorias: number;
  totalInscritos: number;
  inscricoesTotaisOficiais: number;
  totalPartidas: number;
  totalPartidasCalculadas: number;
  totalPartidasWo: number;
  totalPartidasJogadas: number;
  lastScrapeAt: string | null;
};

type MedalistsSnapshot = {
  categories: number;
  categoriesWithMedalists: number;
  calculatedMatchesSum: number;
  playedMatchesSum: number;
  walkoversSum: number;
};

type PageFingerprint = {
  cssHash: string | null;
  eventPageChunkHash: string | null;
  title: string | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    eventId: 0,
    localApiBase: "http://localhost:4000",
    prodApiBase: "https://api-pingpongpaidegua.duckdns.org",
    vercelBase: "https://pingpongpaidegua.vercel.app",
    localWebBase: "http://localhost:3000",
    vmWebUrl: "http://localhost:3000",
    vmSshTarget: null,
    vmSshPort: 22,
    vmSshKey: null,
    vmRepoPath: "~/pingpongpaidegua",
    skipVmWeb: false,
    vmSshNoHostKeyCheck: false,
    strict: false,
    skipLocalApi: false,
    skipLocalWeb: false,
    skipVm: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    const next = argv[index + 1];
    if (token === "--eventId" && next) {
      args.eventId = Number(next);
      index += 1;
      continue;
    }
    if (token === "--localApiBase" && next) {
      args.localApiBase = next;
      index += 1;
      continue;
    }
    if (token === "--prodApiBase" && next) {
      args.prodApiBase = next;
      index += 1;
      continue;
    }
    if (token === "--vercelBase" && next) {
      args.vercelBase = next;
      index += 1;
      continue;
    }
    if (token === "--localWebBase" && next) {
      args.localWebBase = next;
      index += 1;
      continue;
    }
    if (token === "--vmWebUrl" && next) {
      args.vmWebUrl = next;
      index += 1;
      continue;
    }
    if (token === "--vmSshTarget" && next) {
      args.vmSshTarget = next;
      index += 1;
      continue;
    }
    if (token === "--vmSshPort" && next) {
      args.vmSshPort = Number(next);
      index += 1;
      continue;
    }
    if (token === "--vmSshKey" && next) {
      args.vmSshKey = next;
      index += 1;
      continue;
    }
    if (token === "--vmRepoPath" && next) {
      args.vmRepoPath = next;
      index += 1;
      continue;
    }
    if (token === "--strict") {
      args.strict = true;
      continue;
    }
    if (token === "--skipVmWeb") {
      args.skipVmWeb = true;
      continue;
    }
    if (token === "--vmSshNoHostKeyCheck") {
      args.vmSshNoHostKeyCheck = true;
      continue;
    }
    if (token === "--skipLocalApi") {
      args.skipLocalApi = true;
      continue;
    }
    if (token === "--skipLocalWeb") {
      args.skipLocalWeb = true;
      continue;
    }
    if (token === "--skipVm") {
      args.skipVm = true;
      continue;
    }
  }

  if (!Number.isFinite(args.eventId) || args.eventId <= 0) {
    throw new Error("Uso: tsx scripts/drift-check.ts --eventId <idInternoEvento>");
  }

  return args;
}

function run(command: string, commandArgs: string[]): string {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    const stdout = (result.stdout ?? "").trim();
    throw new Error(`Falha ao executar '${command} ${commandArgs.join(" ")}': ${stderr || stdout || "erro desconhecido"}`);
  }
  return (result.stdout ?? "").trim();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} em ${url}`);
  }
  return (await response.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} em ${url}`);
  }
  return await response.text();
}

function parsePageFingerprint(html: string): PageFingerprint {
  const css = html.match(/\/_next\/static\/css\/([a-f0-9]+)\.css/i)?.[1] ?? null;
  const chunk = html.match(/\/app\/events\/%5Bid%5D\/page-([a-f0-9]+)\.js/i)?.[1] ?? null;
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ?? null;
  return { cssHash: css, eventPageChunkHash: chunk, title };
}

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function mapEventSnapshot(raw: Record<string, unknown>): EventSnapshot {
  return {
    id: toNumber(raw.id),
    nome: String(raw.nome ?? ""),
    cbtmEventId: raw.cbtmEventId == null ? null : toNumber(raw.cbtmEventId),
    totalCategorias: toNumber(raw.totalCategorias),
    totalInscritos: toNumber(raw.totalInscritos),
    inscricoesTotaisOficiais: toNumber(raw.inscricoesTotaisOficiais),
    totalPartidas: toNumber(raw.totalPartidas),
    totalPartidasCalculadas: toNumber(raw.totalPartidasCalculadas),
    totalPartidasWo: toNumber(raw.totalPartidasWo),
    totalPartidasJogadas: toNumber(raw.totalPartidasJogadas),
    lastScrapeAt: raw.lastScrapeAt == null ? null : String(raw.lastScrapeAt),
  };
}

function mapMedalistsSnapshot(raw: Record<string, unknown>): MedalistsSnapshot {
  const categories = Array.isArray(raw.categories) ? (raw.categories as Array<Record<string, unknown>>) : [];
  return {
    categories: categories.length,
    categoriesWithMedalists: categories.filter((category) =>
      Array.isArray(category.medalists) && category.medalists.length > 0,
    ).length,
    calculatedMatchesSum: categories.reduce((sum, category) => sum + toNumber(category.calculatedMatchesCount), 0),
    playedMatchesSum: categories.reduce((sum, category) => sum + toNumber(category.playedMatchesCount), 0),
    walkoversSum: categories.reduce((sum, category) => sum + toNumber(category.walkoverMatchesCount), 0),
  };
}

function parseVmGitStatus(raw: string): { head: string; changedFiles: string[] } {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headLine = lines.find((line) => line.startsWith("HEAD="));
  const head = headLine?.slice("HEAD=".length) ?? "";
  const changedFiles = lines.filter((line) => !line.startsWith("HEAD="));
  return { head, changedFiles };
}

function runSsh(target: string, keyPath: string | null, remoteCommand: string, opts?: { noHostKeyCheck?: boolean; port?: number }): string {
  const args: string[] = [];
  if (keyPath) {
    args.push("-i", keyPath);
  }
  if (opts?.port && Number.isFinite(opts.port) && opts.port > 0) {
    args.push("-p", String(opts.port));
  }
  if (opts?.noHostKeyCheck) {
    args.push("-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null");
  }
  args.push(target, remoteCommand);
  return run("ssh", args);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const driftReasons: string[] = [];

  const localHead = run("git", ["rev-parse", "HEAD"]);
  const originHead = run("git", ["rev-parse", "origin/main"]);
  const localChanges = run("git", ["status", "--short"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (localHead !== originHead) {
    driftReasons.push(`local_head_diff_origin (${localHead} != ${originHead})`);
  }
  if (localChanges.length > 0) {
    driftReasons.push(`local_worktree_dirty (${localChanges.length} arquivo(s))`);
  }

  let vmGit: { head: string; changedFiles: string[] } | null = null;
  if (!args.skipVm && args.vmSshTarget) {
    const vmStatusRaw = runSsh(
      args.vmSshTarget,
      args.vmSshKey,
      `cd ${args.vmRepoPath} && git status --short && echo HEAD=$(git rev-parse HEAD)`,
      { noHostKeyCheck: args.vmSshNoHostKeyCheck, port: args.vmSshPort },
    );
    vmGit = parseVmGitStatus(vmStatusRaw);
    if (vmGit.head && vmGit.head !== originHead) {
      driftReasons.push(`vm_head_diff_origin (${vmGit.head} != ${originHead})`);
    }
    if (vmGit.changedFiles.length > 0) {
      driftReasons.push(`vm_worktree_dirty (${vmGit.changedFiles.length} arquivo(s))`);
    }
  }

  const vercelHtml = await fetchText(`${args.vercelBase.replace(/\/$/, "")}/events/${args.eventId}`);
  const vercelFingerprint = parsePageFingerprint(vercelHtml);

  let localFingerprint: PageFingerprint | null = null;
  if (!args.skipLocalWeb) {
    try {
      const localHtml = await fetchText(`${args.localWebBase.replace(/\/$/, "")}/events/${args.eventId}`);
      localFingerprint = parsePageFingerprint(localHtml);
      if (
        localFingerprint.eventPageChunkHash &&
        vercelFingerprint.eventPageChunkHash &&
        localFingerprint.eventPageChunkHash !== vercelFingerprint.eventPageChunkHash
      ) {
        driftReasons.push("frontend_local_diff_vercel (chunk)");
      }
    } catch (error) {
      driftReasons.push(`frontend_local_unavailable (${String((error as Error).message)})`);
    }
  }

  let vmFingerprint: PageFingerprint | null = null;
  if (!args.skipVm && args.vmSshTarget && !args.skipVmWeb) {
    try {
      const vmHtml = runSsh(
        args.vmSshTarget,
        args.vmSshKey,
        `curl -s ${args.vmWebUrl.replace(/\/$/, "")}/events/${args.eventId}`,
        { noHostKeyCheck: args.vmSshNoHostKeyCheck, port: args.vmSshPort },
      );
      vmFingerprint = parsePageFingerprint(vmHtml);
      if (
        vmFingerprint.eventPageChunkHash &&
        vercelFingerprint.eventPageChunkHash &&
        vmFingerprint.eventPageChunkHash !== vercelFingerprint.eventPageChunkHash
      ) {
        driftReasons.push("frontend_vm_diff_vercel (chunk)");
      }
    } catch (error) {
      driftReasons.push(`frontend_vm_unavailable (${String((error as Error).message)})`);
    }
  }

  const prodEventRaw = await fetchJson<Record<string, unknown>>(
    `${args.prodApiBase.replace(/\/$/, "")}/events/${args.eventId}`,
  );
  const prodMedalistsRaw = await fetchJson<Record<string, unknown>>(
    `${args.prodApiBase.replace(/\/$/, "")}/events/${args.eventId}/medalists`,
  );
  const prodEvent = mapEventSnapshot(prodEventRaw);
  const prodMedalists = mapMedalistsSnapshot(prodMedalistsRaw);

  if (prodEvent.totalPartidasJogadas !== prodEvent.totalPartidas - prodEvent.totalPartidasWo) {
    driftReasons.push("prod_summary_played_inconsistent");
  }
  if (prodMedalists.playedMatchesSum !== prodMedalists.calculatedMatchesSum - prodMedalists.walkoversSum) {
    driftReasons.push("prod_category_played_inconsistent");
  }
  if (prodEvent.totalPartidasJogadas !== prodMedalists.playedMatchesSum) {
    driftReasons.push("prod_summary_vs_categories_played_mismatch");
  }

  let localEvent: EventSnapshot | null = null;
  let localMedalists: MedalistsSnapshot | null = null;
  if (!args.skipLocalApi) {
    try {
      const localEventRaw = await fetchJson<Record<string, unknown>>(
        `${args.localApiBase.replace(/\/$/, "")}/events/${args.eventId}`,
      );
      const localMedalistsRaw = await fetchJson<Record<string, unknown>>(
        `${args.localApiBase.replace(/\/$/, "")}/events/${args.eventId}/medalists`,
      );
      localEvent = mapEventSnapshot(localEventRaw);
      localMedalists = mapMedalistsSnapshot(localMedalistsRaw);

      if (localEvent.totalPartidas !== prodEvent.totalPartidas) {
        driftReasons.push(`api_local_vs_prod_totalPartidas (${localEvent.totalPartidas} != ${prodEvent.totalPartidas})`);
      }
      if (localEvent.inscricoesTotaisOficiais !== prodEvent.inscricoesTotaisOficiais) {
        driftReasons.push(
          `api_local_vs_prod_inscricoesOficiais (${localEvent.inscricoesTotaisOficiais} != ${prodEvent.inscricoesTotaisOficiais})`,
        );
      }
      if (localEvent.totalCategorias !== prodEvent.totalCategorias) {
        driftReasons.push(`api_local_vs_prod_totalCategorias (${localEvent.totalCategorias} != ${prodEvent.totalCategorias})`);
      }
    } catch (error) {
      driftReasons.push(`api_local_unavailable (${String((error as Error).message)})`);
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    input: args,
    git: {
      local: {
        head: localHead,
        originMainHead: originHead,
        dirtyFilesCount: localChanges.length,
        dirtyFiles: localChanges,
      },
      vm: vmGit,
    },
    frontend: {
      vercel: vercelFingerprint,
      local: localFingerprint,
      vm: vmFingerprint,
    },
    api: {
      prod: {
        event: prodEvent,
        medalists: prodMedalists,
      },
      local:
        localEvent && localMedalists
          ? {
              event: localEvent,
              medalists: localMedalists,
            }
          : null,
    },
    drift: {
      detected: driftReasons.length > 0,
      reasons: driftReasons,
    },
  };

  console.log(JSON.stringify(report, null, 2));

  if (args.strict && driftReasons.length > 0) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(String(error?.stack ?? error?.message ?? error));
  process.exit(1);
});
