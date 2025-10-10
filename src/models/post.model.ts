import { Schema, model, InferSchemaType } from "mongoose";
import type { Visibility } from "./enums";

const postSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    caption: { type: String, maxlength: 2200 },
    music: { type: String },
    like_count: { type: Number, default: 0 },
    love_count: { type: Number, default: 0 },
    haha_count: { type: Number, default: 0 },
    sad_count: { type: Number, default: 0 },
    angry_count: { type: Number, default: 0 },
    comments_count: { type: Number, default: 0 },
    saves_count: { type: Number, default: 0 },
    views_count: { type: Number, default: 0 },
    thumbnail: { type: String },
    tags: { type: [Schema.Types.Mixed], default: [] },
    video_src: { type: String, required: true },
    visibility: {
      type: String,
      required: true,
      enum: [
        "Public",
        "Friends",
        "Private",
        "Organizations",
      ] satisfies Visibility[],
      default: "Public",
    },
    allow_comments: { type: Boolean, default: true },
    created_at: { type: Date, default: () => new Date() },
    updated_at: { type: Date, default: () => new Date() },
  },
  {
    collection: "posts",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

postSchema.index({ created_at: 1 }, { name: "idx_posts_created_at" });

export type Post = InferSchemaType<typeof postSchema> & {
  _id: Schema.Types.ObjectId;
};
export const PostModel = model("Post", postSchema);
