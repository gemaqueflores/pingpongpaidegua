import assert from "node:assert/strict";
import test, { after, mock } from "node:test";
import { SupportReportLimiter } from "../src/common/support-report-limiter";
import { UserService } from "../src/user/user.service";

let captureMail: ((mail: Record<string, unknown>) => void) | undefined;

const createTransport = () => ({
  async sendMail(mail: Record<string, unknown>) {
    captureMail?.(mail);
    return {};
  },
});
const nodemailerMock = mock.module("nodemailer", {
  namedExports: { createTransport },
});

after(() => {
  nodemailerMock.restore();
});

async function captureSupportEmail(title: string, description: string): Promise<Record<string, unknown>> {
  const originalEnv = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_FROM: process.env.SMTP_FROM,
  };
  let sentMail: Record<string, unknown> | undefined;

  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "test-user";
  process.env.SMTP_PASS = "test-pass";
  process.env.SMTP_FROM = "noreply@example.test";
  captureMail = (mail) => {
    sentMail = mail;
  };

  try {
    const service = new UserService(
      {} as never,
      {} as never,
      new SupportReportLimiter({ redis: null }),
    );
    await service.reportProblem(title, description);
  } finally {
    captureMail = undefined;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  assert.ok(sentMail, "sendMail deve receber o e-mail de suporte");
  return sentMail;
}

test("T-U-01 escapa HTML no subject do e-mail de suporte", async () => {
  const sentMail = await captureSupportEmail("<b>Bug</b> no ranking", "texto normal");

  assert.equal(sentMail.subject, "Bug Site: &lt;b&gt;Bug&lt;/b&gt; no ranking");
  assert.doesNotMatch(String(sentMail.subject), /<b>/);
});

test("T-U-02 preserva subject sem caracteres especiais", async () => {
  const sentMail = await captureSupportEmail("Erro no ranking", "texto normal");

  assert.equal(sentMail.subject, "Bug Site: Erro no ranking");
});
