FROM node:20-alpine
WORKDIR /workspace

COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/package.json

RUN npm install

COPY apps/web ./apps/web

RUN npm run build --workspace apps-web

EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "apps-web"]
