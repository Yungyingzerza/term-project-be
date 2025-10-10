import axios from "axios";
import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import NodeFormData from "form-data";
import usersWithIds from "./usersWithIds.json";
import captions from "./captions.json";

// Configuration
const API_URL = process.env.API_URL || "http://localhost:8000";
const VIDEOS_DIR = "/Users/yungyingzerza/Downloads/Mock Video";
const UPLOAD_ENDPOINT = `${API_URL}/media/upload/mock`;
const UPLOADED_VIDEOS_FILE = path.join(__dirname, "uploadedVideos.json");

// Type for tracking uploaded videos
type UploadedVideo = {
  videoName: string;
  videoPath: string;
  postId: string;
  userId: string;
  username: string;
  caption: string;
  uploadedAt: string;
};

// Load uploaded videos history
function loadUploadedVideos(): UploadedVideo[] {
  try {
    if (fs.existsSync(UPLOADED_VIDEOS_FILE)) {
      const data = fs.readFileSync(UPLOADED_VIDEOS_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn(`⚠️  Could not load uploaded videos history: ${error}`);
  }
  return [];
}

// Save uploaded videos history
function saveUploadedVideos(uploadedVideos: UploadedVideo[]): void {
  try {
    fs.writeFileSync(
      UPLOADED_VIDEOS_FILE,
      JSON.stringify(uploadedVideos, null, 2),
      "utf-8"
    );
  } catch (error) {
    console.error(`❌ Error saving uploaded videos history: ${error}`);
  }
}

// Get all video files from the directory
function getVideoFiles(): string[] {
  try {
    const files = fs.readdirSync(VIDEOS_DIR);
    return files
      .filter((file) => file.endsWith(".mp4"))
      .map((file) => path.join(VIDEOS_DIR, file));
  } catch (error) {
    console.error(`❌ Error reading videos directory: ${VIDEOS_DIR}`);
    console.error(error);
    return [];
  }
}

// Get random item from array
function getRandomItem<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

const bunGlobal = (globalThis as { Bun?: any }).Bun;
const isBun = typeof bunGlobal !== "undefined" && typeof fetch === "function";

// Upload a single video
async function uploadVideo(
  videoPath: string,
  userId: string,
  username: string,
  caption: string
): Promise<string | null> {
  try {
    const videoName = path.basename(videoPath);
    console.log(`📤 Uploading: ${videoName}`);
    console.log(`   User: ${username} (${userId})`);
    console.log(
      `   Caption: ${caption.substring(0, 50)}${
        caption.length > 50 ? "..." : ""
      }`
    );

    if (isBun) {
      // Use Bun's native fetch + FormData for better streaming support
      const formData = new (globalThis as any).FormData();
      const videoFile = bunGlobal.file(videoPath);
      const fileName = path.basename(videoPath);

      formData.append("video", videoFile, fileName);
      formData.append("userId", userId);
      formData.append("caption", caption);
      formData.append("visibility", "Public");

      const response = await fetch(UPLOAD_ENDPOINT, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorPayload = await safeParseJson(response);
        throw new Error(
          errorPayload?.error ||
            errorPayload?.message ||
            `Upload failed with status ${response.status}`
        );
      }

      const data = await response.json();
      const postId = data.postId;
      console.log(`✅ Success! Post ID: ${postId}\n`);
      return postId;
    }

    // Node.js fallback using axios + form-data
    const formData = new NodeFormData();
    const videoStream = fs.createReadStream(videoPath);
    formData.append("video", videoStream, {
      filename: path.basename(videoPath),
    });
    formData.append("userId", userId);
    formData.append("caption", caption);
    formData.append("visibility", "Public");

    const axiosInstance = axios.create({
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 300000,
      httpAgent: new http.Agent({ keepAlive: false }),
      httpsAgent: new https.Agent({ keepAlive: false }),
    });

    const response = await axiosInstance.post(UPLOAD_ENDPOINT, formData, {
      headers: formData.getHeaders(),
    });

    const postId = response.data.postId;
    console.log(`✅ Success! Post ID: ${postId}\n`);
    return postId;
  } catch (error: any) {
    console.error(`❌ Failed to upload ${path.basename(videoPath)}`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(
        `   Message: ${error.response.data?.message || "Unknown error"}`
      );
      if (error.response.data?.error) {
        console.error(`   Error details: ${error.response.data.error}`);
      }
    } else {
      console.error(`   Error: ${error.message}`);
    }
    console.error("");
    return null;
  }
}

async function safeParseJson(response: any) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

// Main function
async function uploadMockVideos() {
  console.log("🎬 Mock Video Upload Script");
  console.log("=".repeat(50));
  console.log(`📁 Videos directory: ${VIDEOS_DIR}`);
  console.log(`🌐 API endpoint: ${UPLOAD_ENDPOINT}`);
  console.log("=".repeat(50) + "\n");

  // Load uploaded videos history
  const uploadedVideos = loadUploadedVideos();
  const uploadedVideoNames = new Set(uploadedVideos.map((v) => v.videoName));

  console.log(
    `📝 Uploaded videos history: ${uploadedVideos.length} video(s) already uploaded`
  );

  // Validate users data
  if (!usersWithIds || usersWithIds.length === 0) {
    console.error("❌ No users found in usersWithIds.json");
    console.error("   Please run: bun run seeders/createMockUsers.ts");
    process.exit(1);
  }

  // Validate captions data
  if (!captions || captions.length === 0) {
    console.error("❌ No captions found in captions.json");
    process.exit(1);
  }

  // Get video files
  const allVideoFiles = getVideoFiles();
  if (allVideoFiles.length === 0) {
    console.error(`❌ No videos found in ${VIDEOS_DIR}`);
    process.exit(1);
  }

  // Filter out already uploaded videos
  const videoFiles = allVideoFiles.filter(
    (videoPath) => !uploadedVideoNames.has(path.basename(videoPath))
  );

  console.log(`📊 Available resources:`);
  console.log(`   👥 Users: ${usersWithIds.length}`);
  console.log(`   💬 Captions: ${captions.length}`);
  console.log(`   🎥 Total videos: ${allVideoFiles.length}`);
  console.log(`   ✅ Already uploaded: ${uploadedVideos.length}`);
  console.log(`   📹 Available to upload: ${videoFiles.length}\n`);

  if (videoFiles.length === 0) {
    console.log("🎉 All videos have already been uploaded!");
    console.log("💡 To reset and upload again, delete: uploadedVideos.json\n");
    process.exit(0);
  }

  // Get number of uploads from command line or use default
  const numUploads = parseInt(process.argv[2]) || videoFiles.length;
  const actualUploads = Math.min(numUploads, videoFiles.length);

  console.log(`🚀 Starting upload of ${actualUploads} video(s)...\n`);

  // Shuffle videos for random selection
  const shuffledVideos = [...videoFiles].sort(() => Math.random() - 0.5);

  // Upload videos
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < actualUploads; i++) {
    const videoPath = shuffledVideos[i];
    const videoName = path.basename(videoPath);
    const randomUser = getRandomItem(usersWithIds);
    const randomCaption = getRandomItem(captions);

    console.log(`[${i + 1}/${actualUploads}]`);

    const postId = await uploadVideo(
      videoPath,
      randomUser._id,
      randomUser.username,
      randomCaption
    );

    if (postId) {
      // Save to uploaded videos history
      uploadedVideos.push({
        videoName,
        videoPath,
        postId,
        userId: randomUser._id,
        username: randomUser.username,
        caption: randomCaption,
        uploadedAt: new Date().toISOString(),
      });
      saveUploadedVideos(uploadedVideos);
      successCount++;
    } else {
      failCount++;
    }

    // Add a delay between uploads to avoid overwhelming the server
    // and ensure proper cleanup of previous upload
    if (i < actualUploads - 1) {
      console.log(`⏳ Waiting 3 seconds before next upload...\n`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  // Summary
  console.log("=".repeat(50));
  console.log("📊 Upload Summary:");
  console.log(`   ✅ Successful: ${successCount}`);
  console.log(`   ❌ Failed: ${failCount}`);
  console.log(`   📝 Total: ${actualUploads}`);
  console.log(`   📂 History saved to: uploadedVideos.json`);
  console.log("=".repeat(50));

  process.exit(failCount > 0 ? 1 : 0);
}

// Run the script
uploadMockVideos();
