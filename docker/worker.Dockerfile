FROM mcr.microsoft.com/playwright:v1.50.1-jammy
WORKDIR /workspace

COPY package.json package-lock.json* tsconfig.base.json ./
COPY prisma ./prisma
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/parser/package.json ./packages/parser/package.json

RUN npm install
RUN npx playwright install chromium

COPY apps/worker ./apps/worker
COPY packages/shared ./packages/shared
COPY packages/parser ./packages/parser
COPY fixtures ./fixtures

RUN npm run prisma:generate
RUN npm run build --workspace @cbtm/shared
RUN npm run build --workspace @cbtm/parser
RUN npm run build --workspace apps-worker

CMD ["node", "apps/worker/dist/main.js"]
