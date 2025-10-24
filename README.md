# Term Project Backend

Backend service for the **ChillChill** video sharing platform. This codebase exposes RESTful APIs that power user management, video feeds, media uploads, messaging, and organization workflows. The project targets a full-stack architecture and is optimized for containerized deployments.

## Project Team

- วีระศักดิ์ ฮ้อยตะคุ 660615040
- สพล ธิติธนชิต 660615041
- พลพัฒน์ ชาญด้วยวิทย์ 660610873

## Technology Stack

- **Runtime & Language**: Bun 1.x, TypeScript
- **Web Framework & Tooling**: Express 5, Axios for outbound HTTP
- **Database Layer**: MongoDB via Mongoose ODM
- **Caching & Messaging**: Redis
- **Object Storage**: MinIO (S3-compatible)
- **Supporting Utilities**: Multer (file uploads), JSON Web Token (auth), Nodemailer (email)
- **Containerization**: Dedicated Dockerfile for the backend, `docker-compose.yaml` for orchestration

## Getting Started

1. **Prerequisites**
   - Install [Bun](https://bun.sh/) 1.x
   - Install Docker and Docker Compose (required for local infrastructure)
2. **Environment Variables**
   - Duplicate the provided `.env` file or create a new one using the documented keys: `PORT`, `MONGO`, `JWT_SECRET`, `REDIS_URL`, email credentials, and `MINIO_ENDPOINT`
   - Make sure MongoDB, Redis, and MinIO endpoints align with your chosen runtime (local or Docker)
3. **Install Dependencies**
   ```sh
   bun install
   ```
4. **Start the Development Server**
   ```sh
   bun run dev
   ```
   The backend listens on `http://localhost:8000` by default, controlled by `PORT` in `.env`.

## Database Seeding & Mock Data

> Ensure MongoDB is running and that `MONGO` in `.env` points to the active instance before seeding.

1. **Create mock users and generate `usersWithIds.json`:**
   ```sh
   bun run seeders/createMockUsers.ts
   ```
   - Inserts users only when they do not already exist.
   - Outputs `seeders/usersWithIds.json`, which is required by other mock scripts.
2. **(Optional) Upload sample videos to the API:**
   ```sh
   API_URL=https://api.example.com/chillchill \
   bun run seeders/uploadmock.ts (need to edit path in uploadmock.ts)
   ```
   - Update `VIDEOS_DIR` inside the script to point to a directory of `.mp4` files.
   - Requires an accessible `/media/upload/mock` endpoint.
   - Upload history is persisted in `seeders/uploadedVideos.json`.

## Docker Workflow

### Build Images

```sh
# Backend image (this repository)
docker build -t term-backend .

# Frontend image (adjust path to the actual frontend repository)
docker build -t term-frontend ../term-project-fe
```

### Launch the Full Stack Locally

```sh
docker compose up -d
```

- Services exposed: MinIO (`9000`, `9001`), MongoDB (`27017`), Redis (`6379`), Backend (`8000`), Frontend (`3000`)
- `docker-compose.yaml` sources environment values from the same `.env` file used in development.

### Tear Down Containers

```sh
docker compose down
```

- Append `--volumes` to remove persisted data.

## Repository Layout

- `src/` – TypeScript source for Express controllers, models, and middleware
- `seeders/` – Database and media seeding scripts plus supporting JSON assets
- `Dockerfile` – Bun-based backend image with FFmpeg support
- `docker-compose.yaml` – Local orchestration for infrastructure and app services
