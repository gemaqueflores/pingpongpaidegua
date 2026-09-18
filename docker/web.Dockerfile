FROM node:20-alpine
WORKDIR /workspace

COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/package.json

RUN npm install

COPY apps/web ./apps/web

ARG NEXT_PUBLIC_API_URL=https://api-pingpongpaidegua.duckdns.org
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build --workspace apps-web

EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "apps-web"]
