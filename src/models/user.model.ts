import { Schema, model, InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    username: { type: String, required: true },
    handle: { type: String, required: true, unique: true },
    picture_url: { type: String },
    // Optional denormalized list of emails (primary or all). See user_emails collection for normalized records.
    emails: { type: [Schema.Types.Mixed], default: undefined },
    password: { type: String, required: true },
  },
  {
    collection: "users",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

// Indexes
userSchema.index({ username: 1 }, { name: "idx_users_username" });
userSchema.index({ handle: 1 }, { name: "idx_users_handle", unique: true });

export type User = InferSchemaType<typeof userSchema> & {
  _id: Schema.Types.ObjectId;
};
export const UserModel = model("User", userSchema);
