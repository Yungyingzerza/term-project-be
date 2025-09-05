import { Schema, model, InferSchemaType } from "mongoose";

const postSaveSchema = new Schema(
  {
    post_id: { type: Schema.Types.ObjectId, ref: "Post", required: true },
    user_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  {
    collection: "post_saves",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

postSaveSchema.index({ post_id: 1, user_id: 1 }, { unique: true, name: "uq_post_user_save" });

export type PostSave = InferSchemaType<typeof postSaveSchema> & { _id: Schema.Types.ObjectId };
export const PostSaveModel = model("PostSave", postSaveSchema);

