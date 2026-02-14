import { PrismaClient } from "@prisma/client";
import { config } from "./config";

export const prismaWrite = new PrismaClient({
  datasourceUrl: config.databaseWriteUrl,
});

export const prismaRead = new PrismaClient({
  datasourceUrl: config.databaseReadUrl,
});

export const prisma = prismaWrite;
