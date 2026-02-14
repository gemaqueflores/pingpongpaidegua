import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasourceUrl:
        process.env.DATABASE_URL_WRITE ??
        process.env.DATABASE_URL ??
        "postgresql://postgres:postgres@localhost:5432/cbtm",
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

@Injectable()
export class PrismaReadService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasourceUrl:
        process.env.DATABASE_URL_READ ??
        process.env.DATABASE_URL_WRITE ??
        process.env.DATABASE_URL ??
        "postgresql://postgres:postgres@localhost:5432/cbtm",
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

