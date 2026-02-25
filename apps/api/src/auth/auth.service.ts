import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { compareSync, hashSync } from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../common/prisma.service";

interface AuthAccount {
  id: number;
  username: string;
  passwordHash: string;
  role: "ADMIN";
}

interface LoginAttemptState {
  failedCount: number;
  lockUntil: number | null;
}

@Injectable()
export class AuthService {
  private readonly attemptsByKey = new Map<string, LoginAttemptState>();
  private readonly maxFailedAttempts: number;
  private readonly lockoutMs: number;
  private readonly resetTokenTtlMs: number;
  private readonly adminResetEmail: string;
  private readonly adminUsername: string;
  private readonly bootstrapAdminPasswordHash: string;
  private nowProvider: () => number = () => Date.now();

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {
    this.adminUsername = this.resolveAdminUsername();
    this.bootstrapAdminPasswordHash = this.resolveBootstrapAdminPasswordHash();

    if (!this.bootstrapAdminPasswordHash.startsWith("$2")) {
      throw new Error("ADMIN_PASSWORD_HASH invalido: use hash bcrypt");
    }

    const maxAttemptsRaw = Number(process.env.ADMIN_MAX_LOGIN_ATTEMPTS ?? "3");
    this.maxFailedAttempts = Number.isFinite(maxAttemptsRaw) && maxAttemptsRaw > 0 ? Math.floor(maxAttemptsRaw) : 3;

    const lockMinutesRaw = Number(process.env.ADMIN_LOCKOUT_MINUTES ?? "15");
    const lockMinutes =
      Number.isFinite(lockMinutesRaw) && lockMinutesRaw > 0 ? lockMinutesRaw : 15;
    this.lockoutMs = Math.floor(lockMinutes * 60 * 1000);

    const resetTtlRaw = Number(process.env.ADMIN_RESET_TOKEN_TTL_MINUTES ?? "30");
    const resetTtlMinutes = Number.isFinite(resetTtlRaw) && resetTtlRaw > 0 ? resetTtlRaw : 30;
    this.resetTokenTtlMs = Math.floor(resetTtlMinutes * 60 * 1000);
    this.adminResetEmail = (process.env.ADMIN_RESET_EMAIL ?? "gemaqueflores@gmail.com").trim().toLowerCase();
  }

  private isProduction(): boolean {
    return (process.env.NODE_ENV ?? "development") === "production";
  }

  private resolveAdminUsername(): string {
    const configured = process.env.ADMIN_USERNAME?.trim();
    if (configured) {
      return configured;
    }
    if (this.isProduction()) {
      throw new Error("ADMIN_USERNAME obrigatorio em producao.");
    }
    return "mush1n-d0sh4";
  }

  private resolveBootstrapAdminPasswordHash(): string {
    const configured = process.env.ADMIN_PASSWORD_HASH?.trim();
    if (configured) {
      return configured;
    }
    if (this.isProduction()) {
      throw new Error("ADMIN_PASSWORD_HASH obrigatorio em producao.");
    }
    return "$2a$12$Iq1queD4Z4aK9GFqIvVGz..KPrev.5WHB7PJdaAXqLBbLf5XYcthC";
  }

  setNowProvider(nowProvider: () => number): void {
    this.nowProvider = nowProvider;
  }

  private async ensureAdminAccount(): Promise<AuthAccount> {
    const existing = await this.prisma.adminCredential.findUnique({
      where: { username: this.adminUsername },
    });

    if (existing) {
      return {
        id: existing.id,
        username: existing.username,
        passwordHash: existing.passwordHash,
        role: "ADMIN",
      };
    }

    const created = await this.prisma.adminCredential.create({
      data: {
        username: this.adminUsername,
        passwordHash: this.bootstrapAdminPasswordHash,
      },
    });

    return {
      id: created.id,
      username: created.username,
      passwordHash: created.passwordHash,
      role: "ADMIN",
    };
  }

  private normalizeUserKey(value: string): string {
    return String(value ?? "").trim().toLowerCase();
  }

  private buildAttemptKey(username: string, clientIdentifier: string): string {
    const user = this.normalizeUserKey(username);
    const client = String(clientIdentifier ?? "").trim().toLowerCase() || "global";
    return `${client}:${user}`;
  }

  private tokenHash(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }

  private async sendResetEmail(rawToken: string): Promise<void> {
    const smtpHost = process.env.SMTP_HOST?.trim();
    const smtpPort = Number(process.env.SMTP_PORT ?? "587");
    const smtpUser = process.env.SMTP_USER?.trim();
    const smtpPass = process.env.SMTP_PASS?.trim();
    const smtpFrom = process.env.SMTP_FROM?.trim();
    const frontendBaseUrl = process.env.FRONTEND_URL?.trim() || "http://localhost:3000";
    const resetLink = `${frontendBaseUrl.replace(/\/$/, "")}/admin/reset-password?token=${encodeURIComponent(rawToken)}`;

    if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom || !Number.isFinite(smtpPort)) {
      throw new Error(
        "SMTP nao configurado: defina SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS e SMTP_FROM.",
      );
    }

    const moduleName = "nodemailer";
    const nodemailerModule = (await import(moduleName as string)) as {
      createTransport: (config: Record<string, unknown>) => {
        sendMail: (mail: Record<string, unknown>) => Promise<unknown>;
      };
    };

    const transporter = nodemailerModule.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    await transporter.sendMail({
      from: smtpFrom,
      to: this.adminResetEmail,
      subject: "Reset de senha - Admin appcbtmeventos",
      text: `Voce solicitou reset de senha.\n\nAbra o link abaixo para redefinir sua senha:\n${resetLink}\n\nSe voce nao solicitou, ignore este e-mail.`,
      html: [
        "<p>Você solicitou reset de senha.</p>",
        `<p><a href="${resetLink}">Clique aqui para redefinir sua senha</a></p>`,
        "<p>Se você não solicitou, ignore este e-mail.</p>",
      ].join(""),
    });
  }

  async login(
    username: string,
    password: string,
    clientIdentifier = "global",
  ): Promise<{ accessToken: string; role: "ADMIN" }> {
    const now = this.nowProvider();
    const attemptKey = this.buildAttemptKey(username, clientIdentifier);
    const attempt = this.attemptsByKey.get(attemptKey);
    if (attempt?.lockUntil && now < attempt.lockUntil) {
      throw new UnauthorizedException("Limite de tentativas excedido. Tente novamente mais tarde.");
    }

    const account = await this.ensureAdminAccount();
    const validUser = account.username === username ? account : null;

    if (!validUser || !compareSync(password, validUser.passwordHash)) {
      const failedCount = (attempt?.failedCount ?? 0) + 1;
      if (failedCount >= this.maxFailedAttempts) {
        this.attemptsByKey.set(attemptKey, {
          failedCount: 0,
          lockUntil: now + this.lockoutMs,
        });
        throw new UnauthorizedException("Limite de tentativas excedido. Tente novamente mais tarde.");
      }

      this.attemptsByKey.set(attemptKey, {
        failedCount,
        lockUntil: null,
      });
      throw new UnauthorizedException("Credenciais invalidas");
    }

    this.attemptsByKey.delete(attemptKey);

    const payload = {
      sub: validUser.username,
      username: validUser.username,
      role: validUser.role,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      role: validUser.role,
    };
  }

  async forgotPassword(_username: string): Promise<{ success: true; message: string }> {
    await this.ensureAdminAccount();
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = this.tokenHash(rawToken);
    const expiresAt = new Date(this.nowProvider() + this.resetTokenTtlMs);

    await this.prisma.passwordResetToken.create({
      data: {
        email: this.adminResetEmail,
        tokenHash,
        expiresAt,
      },
    });

    await this.sendResetEmail(rawToken);

    return {
      success: true,
      message: "Se o e-mail estiver habilitado, voce recebera as instrucoes de reset.",
    };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ success: true }> {
    const account = await this.ensureAdminAccount();
    const tokenHash = this.tokenHash(token);
    const now = new Date(this.nowProvider());

    const row = await this.prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
      },
      orderBy: [{ createdAt: "desc" }],
    });

    if (!row || row.usedAt || row.expiresAt.getTime() < now.getTime()) {
      throw new UnauthorizedException("Token de reset invalido ou expirado.");
    }

    const nextHash = hashSync(newPassword, 12);
    await this.prisma.adminCredential.update({
      where: { id: account.id },
      data: {
        passwordHash: nextHash,
      },
    });

    await this.prisma.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: now },
    });

    return { success: true };
  }
}
