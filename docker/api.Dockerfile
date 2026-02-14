FROM node:20-alpine
WORKDIR /workspace

COPY package.json package-lock.json* tsconfig.base.json ./
COPY prisma ./prisma
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/parser/package.json ./packages/parser/package.json

RUN npm install

COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
COPY packages/parser ./packages/parser

RUN npm run prisma:generate
RUN npm run build --workspace @cbtm/shared
RUN npm run build --workspace @cbtm/parser
RUN npm run build --workspace apps-api

EXPOSE 4000
CMD ["sh", "-c", "npm run prisma:deploy && node apps/api/dist/main.js"]
