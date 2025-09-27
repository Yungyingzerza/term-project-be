FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install

COPY . /app

CMD ["bun", "run", "src/index.ts"]
