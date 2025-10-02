import { Schema, model, InferSchemaType } from "mongoose";

const viewSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    post_id: { type: Schema.Types.ObjectId, ref: "Post", required: true },
    watch_time: { type: Number, default: 0, min: 0 },
    created_at: { type: Date, default: () => new Date() },
    updated_at: { type: Date, default: () => new Date() },
  },
  {
    collection: "views",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

viewSchema.index({ user_id: 1, post_id: 1 }, { unique: true, name: "uq_view_user_post" });

export type View = InferSchemaType<typeof viewSchema> & {
  _id: Schema.Types.ObjectId;
};
export const ViewModel = model("View", viewSchema);
