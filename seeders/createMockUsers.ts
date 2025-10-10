import mongoose from "mongoose";
import dotenv from "dotenv";
import { UserModel } from "../src/models/user.model";
import usersData from "./users.json";
import fs from "fs";
import path from "path";

// Load environment variables
dotenv.config();

async function createMockUsers() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO || "";
    if (!mongoUri) {
      throw new Error("MONGO environment variable is not set");
    }

    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");

    // Array to store all users with their IDs
    const usersWithIds: Array<{
      _id: string;
      username: string;
      handle: string;
      picture_url: string;
    }> = [];

    // Check if users already exist and create only if they don't
    let createdCount = 0;
    let skippedCount = 0;

    for (const userData of usersData) {
      // Check if user with this handle already exists
      const existingUser = await UserModel.findOne({ handle: userData.handle });

      if (existingUser) {
        console.log(
          `⏭️  Skipped: User with handle "${userData.handle}" already exists (using existing ID)`
        );
        skippedCount++;

        // Add existing user to the array
        usersWithIds.push({
          _id: existingUser._id.toString(),
          username: existingUser.username,
          handle: existingUser.handle,
          picture_url: existingUser.picture_url || "",
        });
        continue;
      }

      // Create new user
      const newUser = await UserModel.create({
        username: userData.username,
        handle: userData.handle,
        picture_url: userData.picture_url,
      });

      console.log(
        `✨ Created: ${newUser.username} (@${newUser.handle}) - ID: ${newUser._id}`
      );
      createdCount++;

      // Add new user to the array
      usersWithIds.push({
        _id: newUser._id.toString(),
        username: newUser.username,
        handle: newUser.handle,
        picture_url: newUser.picture_url || "",
      });
    }

    // Save users with IDs to JSON file
    const outputPath = path.join(__dirname, "usersWithIds.json");
    fs.writeFileSync(
      outputPath,
      JSON.stringify(usersWithIds, null, 2),
      "utf-8"
    );
    console.log(`\n💾 Saved user IDs to: ${outputPath}`);

    console.log("\n📊 Summary:");
    console.log(`   ✅ Created: ${createdCount} users`);
    console.log(`   ⏭️  Skipped: ${skippedCount} users (already exist)`);
    console.log(`   📝 Total processed: ${usersData.length} users`);
    console.log(`   📄 Total users with IDs: ${usersWithIds.length}`);
  } catch (error) {
    console.error("❌ Error creating mock users:", error);
    process.exit(1);
  } finally {
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log("\n🔌 MongoDB connection closed");
    process.exit(0);
  }
}

// Run the seeder
createMockUsers();
