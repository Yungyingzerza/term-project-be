import { Schema, model, InferSchemaType } from "mongoose";
import type { ReactionKey } from "./enums";

const postReactionSchema = new Schema(
  {
    post_id: { type: Schema.Types.ObjectId, ref: "Post", required: true },
    user_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    key: { type: String, required: true, enum: ["like", "love", "haha", "sad", "angry"] satisfies ReactionKey[] },
    created_at: { type: Date, default: () => new Date() },
    updated_at: { type: Date, default: () => new Date() },
  },
  {
    collection: "post_reactions",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

postReactionSchema.index({ post_id: 1, user_id: 1 }, { unique: true, name: "uq_post_user_reaction" });

export type PostReaction = InferSchemaType<typeof postReactionSchema> & { _id: Schema.Types.ObjectId };
export const PostReactionModel = model("PostReaction", postReactionSchema);

