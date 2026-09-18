import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import ts from "typescript";
import { AuthUser } from "../src/common/current-user.decorator";
import { Roles } from "../src/common/roles.decorator";
import { RolesGuard } from "../src/common/roles.guard";

test("PP-046 T-U-01: RolesGuard autoriza ADMIN com metadata real", () => {
  @Roles("ADMIN")
  class AdminController {}

  const user: AuthUser = { userId: "admin", username: "admin", role: "ADMIN" };
  const context = {
    getHandler: () => function handler() {},
    getClass: () => AdminController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as ExecutionContext;

  assert.equal(new RolesGuard(new Reflector()).canActivate(context), true);
});

test("PP-046 T-U-02: compilador aceita ADMIN e rejeita USER em AuthUser.role", () => {
  // tsx nao verifica tipos; compilar uma fixture virtual com o TypeScript real.
  const fixturePath = path.join(__dirname, "auth-user-role.fixture.ts");
  const source = [
    'import type { AuthUser } from "../src/common/current-user.decorator";',
    'const admin: AuthUser["role"] = "ADMIN";',
    'const unsupported: AuthUser["role"] = "USER";',
  ].join("\n");
  const configPath = path.resolve(__dirname, "../tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
  assert.deepEqual(parsed.errors, []);
  const options = { ...parsed.options, rootDir: undefined, noEmit: true, incremental: false };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    path.resolve(fileName) === fixturePath
      ? ts.createSourceFile(fileName, source, languageVersion, true)
      : originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([fixturePath], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);

  assert.equal(diagnostics.length, 1, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => "\n",
  }));
  const diagnostic = diagnostics[0];
  assert.equal(diagnostic.code, 2322);
  assert.equal(path.resolve(diagnostic.file!.fileName), fixturePath);
  assert.equal(diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start!).line, 2);
  assert.match(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"), /"USER".*"ADMIN"/);
});
