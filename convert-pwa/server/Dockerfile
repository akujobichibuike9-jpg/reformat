FROM node:20-bookworm-slim

# LibreOffice (Writer/Calc/Impress) + a solid font set so PDFs render correctly.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer \
      libreoffice-calc \
      libreoffice-impress \
      fonts-liberation \
      fonts-dejavu \
      fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# install deps first for better layer caching
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./

ENV NODE_ENV=production
# Railway injects PORT; default for local runs
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
