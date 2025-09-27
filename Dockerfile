FROM oven/bun:1

WORKDIR /app

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

USER bun

COPY package.json bun.lock ./

RUN bun install

COPY . /app

CMD ["bun", "run", "src/index.ts"]
