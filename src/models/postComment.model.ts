import { Schema, model, InferSchemaType } from "mongoose";
import type { CommentVisibility } from "./enums";

const postCommentSchema = new Schema(
  {
    post_id: { type: Schema.Types.ObjectId, ref: "Post", required: true },
    user_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    parent_comment_id: { type: Schema.Types.ObjectId, ref: "PostComment" },
    text: { type: String, required: true, maxlength: 1000 },
    visibility: {
      type: String,
      enum: ["Public", "OwnerOnly"] satisfies CommentVisibility[],
      default: "Public",
    },
    deleted_at: { type: Date },
  },
  {
    collection: "post_comments",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

postCommentSchema.index({ post_id: 1, created_at: 1 }, { name: "idx_comments_post_created" });
postCommentSchema.index({ post_id: 1, visibility: 1, created_at: 1 }, { name: "idx_comments_vis_created" });
postCommentSchema.index({ parent_comment_id: 1 }, { name: "idx_comments_parent" });

export type PostComment = InferSchemaType<typeof postCommentSchema> & { _id: Schema.Types.ObjectId };
export const PostCommentModel = model("PostComment", postCommentSchema);

