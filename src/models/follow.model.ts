import { Schema, model, InferSchemaType } from "mongoose";

const followSchema = new Schema(
  {
    follower_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    followee_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  {
    collection: "follows",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

followSchema.index({ follower_id: 1, followee_id: 1 }, { unique: true, name: "uq_follower_followee" });

export type Follow = InferSchemaType<typeof followSchema> & { _id: Schema.Types.ObjectId };
export const FollowModel = model("Follow", followSchema);

